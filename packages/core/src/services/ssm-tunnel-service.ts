import { BehaviorSubject, Subscription } from "rxjs";
import { INativeService } from "../interfaces/i-native-service";
import { SsmTunnel, SsmTunnelState, SsmTunnelStatus } from "../models/ssm-tunnel";
import { Session } from "../models/session";
import { SessionStatus } from "../models/session-status";
import { Repository } from "./repository";
import { SessionFactory } from "./session-factory";
import { AwsSessionService } from "./session/aws/aws-session-service";
import { BehaviouralSubjectService } from "./behavioural-subject-service";
import { LoggedEntry, LogLevel, LogService } from "./log-service";
import { portForwardingArgs } from "./ssm-service";
import { constants } from "../models/constants";

// Where the AWS CLI and the Session Manager plugin are installed on macOS. An app opened from the Finder gets a minimal
// PATH, and the AWS CLI finds session-manager-plugin through PATH.
const binaryDirectories = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/local/sessionmanagerplugin/bin", "/usr/bin"];

// The AWS CLI prints this once the local port listens
const readyMessage = "Waiting for connections";

// What the processes of a tunnel run: the AWS CLI, then the plugin it starts
const ssmCommands = ["ssm start-session", "session-manager-plugin"];

// Delays before each reconnection attempt after a tunnel drops
export const reconnectDelaysMs = [2000, 5000, 15000];

interface TunnelRun {
  process?: any;
  stopping: boolean;
  attempts: number;
  lastError?: string;
  timer?: any;
}

/**
 * Runs saved SSM port forwardings in the background: each tunnel is an AWS CLI process with fresh credentials in its
 * environment. A tunnel that drops is started again with new credentials, up to three times in a row.
 */
export class SsmTunnelService {
  readonly states$ = new BehaviorSubject<Map<string, SsmTunnelState>>(new Map());

  private runs = new Map<string, TunnelRun>();
  private sessionStatuses = new Map<string, SessionStatus>();
  private sessionsSubscription: Subscription;

  constructor(
    private repository: Repository,
    private sessionFactory: SessionFactory,
    private nativeService: INativeService,
    private logService: LogService,
    private behaviouralSubjectService: BehaviouralSubjectService
  ) {}

  /**
   * Start the auto-start tunnels of each session that becomes active
   */
  watchSessions(): void {
    this.sessionsSubscription?.unsubscribe();
    this.sessionsSubscription = this.behaviouralSubjectService.sessions$.subscribe((sessions: Session[]) => {
      for (const session of sessions) {
        const previous = this.sessionStatuses.get(session.sessionId);
        this.sessionStatuses.set(session.sessionId, session.status);
        if (session.status === SessionStatus.active && previous !== undefined && previous !== SessionStatus.active) {
          this.repository
            .listSsmTunnels()
            .filter((tunnel) => tunnel.sessionId === session.sessionId && tunnel.autoStart)
            .forEach((tunnel) => this.start(tunnel.id));
        }
      }
    });
  }

  /**
   * Stop the tunnels a previous run of the app left behind (a crash or a forced quit): each runs in its own process
   * group, so it outlives the app. A group is stopped only while one of its processes still runs an SSM session, even
   * when the AWS CLI that led it is gone and only session-manager-plugin is left.
   */
  async stopOrphanTunnels(): Promise<void> {
    const groups = this.readRegistry().filter((pgid) => this.isAlive(-pgid));
    if (groups.length > 0) {
      const processes = await this.processList();
      for (const pgid of groups) {
        if (processes.some((process) => process.pgid === pgid && ssmCommands.some((command) => process.command.includes(command)))) {
          this.kill({ pid: pgid });
          this.logService.log(new LoggedEntry(`Stopped an SSM tunnel left by a previous run (process group ${pgid})`, this, LogLevel.info));
        }
      }
    }
    this.writeRegistry([]);
  }

  getState(tunnelId: string): SsmTunnelState {
    return this.states$.value.get(tunnelId) ?? { status: SsmTunnelStatus.stopped };
  }

  isRunning(tunnelId: string): boolean {
    return this.runs.has(tunnelId);
  }

  get runningCount(): number {
    return this.runs.size;
  }

  async isLocalPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = this.nativeService.net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, "127.0.0.1");
    });
  }

  /**
   * A local port that is free right now, picked by the system among the unprivileged ones
   */
  async suggestLocalPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = this.nativeService.net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  }

  /**
   * The local port of a tunnel whose Local Port field was left empty. By default the remote port; with the Default Local
   * Port setting on "free", a port free right now when the remote one is taken on this Mac.
   */
  async defaultLocalPort(remotePort: number): Promise<number> {
    if (this.repository.getWorkspace().ssmLocalPort !== constants.ssmLocalPortFree || (await this.isLocalPortFree(remotePort))) {
      return remotePort;
    }
    return this.suggestLocalPort();
  }

  async start(tunnelId: string): Promise<void> {
    if (this.runs.has(tunnelId)) {
      return;
    }
    const tunnel = this.getTunnel(tunnelId);
    if (!tunnel) {
      return;
    }
    const run: TunnelRun = { stopping: false, attempts: 0 };
    this.runs.set(tunnelId, run);
    this.setState(tunnelId, { status: SsmTunnelStatus.starting });

    if (!(await this.isLocalPortFree(tunnel.localPort))) {
      this.fail(tunnelId, `Local port ${tunnel.localPort} is already in use. Stop what uses it, or edit the tunnel to use another port.`);
      return;
    }
    await this.launch(tunnel, run);
  }

  stop(tunnelId: string): void {
    const run = this.runs.get(tunnelId);
    if (!run) {
      return;
    }
    run.stopping = true;
    clearTimeout(run.timer);
    if (run.process && run.process.exitCode === null) {
      this.kill(run.process);
    } else {
      this.runs.delete(tunnelId);
      this.setState(tunnelId, { status: SsmTunnelStatus.stopped });
    }
  }

  /**
   * Stop the tunnel if it runs, then start it again, e.g. with new ports
   */
  async restart(tunnelId: string): Promise<void> {
    if (this.runs.has(tunnelId)) {
      await new Promise<void>((resolve) => {
        const subscription = this.states$.subscribe(() => {
          if (!this.runs.has(tunnelId)) {
            setTimeout(() => subscription.unsubscribe());
            resolve();
          }
        });
        this.stop(tunnelId);
      });
    }
    await this.start(tunnelId);
  }

  stopAll(): void {
    [...this.runs.keys()].forEach((tunnelId) => this.stop(tunnelId));
  }

  private async launch(tunnel: SsmTunnel, run: TunnelRun): Promise<void> {
    let credentials;
    try {
      const session = this.repository.getSessionById(tunnel.sessionId);
      credentials = await (this.sessionFactory.getSessionService(session.type) as AwsSessionService).generateCredentials(session.sessionId);
    } catch (error) {
      this.fail(tunnel.id, `Could not get credentials for the session: ${error.message}`);
      return;
    }
    if (run.stopping) {
      this.runs.delete(tunnel.id);
      this.setState(tunnel.id, { status: SsmTunnelStatus.stopped });
      return;
    }

    const env = {
      ...this.nativeService.process.env,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      PATH: [this.nativeService.process.env.PATH, ...binaryDirectories].filter((dir) => !!dir).join(":"),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_ACCESS_KEY_ID: credentials.sessionToken.aws_access_key_id,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_SECRET_ACCESS_KEY: credentials.sessionToken.aws_secret_access_key,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_SESSION_TOKEN: credentials.sessionToken.aws_session_token,
    };
    // A profile named in the environment would take precedence over these credentials
    delete env.AWS_PROFILE;

    // Its own process group, so stopping the tunnel also stops the session-manager-plugin the AWS CLI starts
    const child = this.nativeService.spawn(this.awsBinary(), portForwardingArgs(tunnel.instanceId, tunnel.region, tunnel), { env, detached: true });
    run.process = child;
    run.lastError = undefined;
    if (child.pid) {
      this.writeRegistry([...this.readRegistry(), child.pid]);
    }

    child.stdout.on("data", (data: any) => {
      if (`${data}`.includes(readyMessage) && this.getState(tunnel.id).status !== SsmTunnelStatus.active) {
        run.attempts = 0;
        this.setState(tunnel.id, { status: SsmTunnelStatus.active, activeSince: new Date().toISOString() });
        this.logService.log(new LoggedEntry(`SSM tunnel "${tunnel.name}" listening on localhost:${tunnel.localPort}`, this, LogLevel.info));
      }
    });
    child.stderr.on("data", (data: any) => {
      const lines = `${data}`
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => !!line);
      if (lines.length > 0) {
        run.lastError = lines[lines.length - 1];
      }
    });
    child.on("error", (error: any) => {
      run.lastError = error.code === "ENOENT" ? "The AWS CLI was not found. Install it and the Session Manager plugin." : error.message;
    });
    child.on("close", (code: number) => {
      // The AWS CLI is gone; make sure a session-manager-plugin it started does not keep the port
      this.kill({ pid: child.pid });
      this.writeRegistry(this.readRegistry().filter((pid) => pid !== child.pid));
      this.onExit(tunnel.id, run, code);
    });
  }

  private onExit(tunnelId: string, run: TunnelRun, code: number): void {
    if (this.runs.get(tunnelId) !== run) {
      return;
    }
    if (run.stopping) {
      this.runs.delete(tunnelId);
      this.setState(tunnelId, { status: SsmTunnelStatus.stopped });
      return;
    }
    const status = this.getState(tunnelId).status;
    const wasConnected = status === SsmTunnelStatus.active || status === SsmTunnelStatus.reconnecting;
    if (wasConnected && run.attempts < reconnectDelaysMs.length) {
      const delay = reconnectDelaysMs[run.attempts];
      run.attempts++;
      this.setState(tunnelId, {
        status: SsmTunnelStatus.reconnecting,
        message: `Connection lost${run.lastError ? ` (${run.lastError})` : ""}. Reconnecting, attempt ${run.attempts} of ${
          reconnectDelaysMs.length
        }.`,
      });
      run.timer = setTimeout(() => {
        const tunnel = this.getTunnel(tunnelId);
        if (tunnel && !run.stopping) {
          this.launch(tunnel, run);
        } else {
          this.runs.delete(tunnelId);
          this.setState(tunnelId, { status: SsmTunnelStatus.stopped });
        }
      }, delay);
      return;
    }
    this.fail(tunnelId, run.lastError ?? `The AWS CLI exited with code ${code}.`);
  }

  private fail(tunnelId: string, message: string): void {
    this.runs.delete(tunnelId);
    this.setState(tunnelId, { status: SsmTunnelStatus.failed, message });
    this.logService.log(new LoggedEntry(`SSM tunnel failed: ${message}`, this, LogLevel.warn));
  }

  private kill(process: any): void {
    try {
      this.nativeService.process.kill(-process.pid, "SIGTERM");
    } catch (_) {
      process.kill?.("SIGTERM");
    }
  }

  private get registryPath(): string {
    return `${this.nativeService.os.homedir()}/${constants.appDataDir}/ssm-tunnels.pids`;
  }

  private readRegistry(): number[] {
    try {
      return JSON.parse(this.nativeService.fs.readFileSync(this.registryPath, "utf8"));
    } catch (_) {
      return [];
    }
  }

  private writeRegistry(pids: number[]): void {
    try {
      this.nativeService.fs.writeFileSync(this.registryPath, JSON.stringify(pids));
    } catch (error) {
      this.logService.log(new LoggedEntry(`Could not record the SSM tunnel processes: ${error.message}`, this, LogLevel.warn));
    }
  }

  private isAlive(pid: number): boolean {
    try {
      this.nativeService.process.kill(pid, 0);
      return true;
    } catch (_) {
      return false;
    }
  }

  // Every process with its process group
  private processList(): Promise<{ pgid: number; command: string }[]> {
    return new Promise((resolve) =>
      this.nativeService.exec("ps -A -o pgid=,command=", (error: any, stdout: string) =>
        resolve(
          error
            ? []
            : `${stdout}`
                .split("\n")
                .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
                .filter((match) => !!match)
                .map((match) => ({ pgid: Number(match[1]), command: match[2] }))
        )
      )
    );
  }

  private awsBinary(): string {
    const directory = binaryDirectories.find((dir) => this.nativeService.fs.existsSync(`${dir}/aws`));
    return directory ? `${directory}/aws` : "aws";
  }

  private getTunnel(tunnelId: string): SsmTunnel | undefined {
    return this.repository.listSsmTunnels().find((tunnel) => tunnel.id === tunnelId);
  }

  private setState(tunnelId: string, state: SsmTunnelState): void {
    const states = new Map(this.states$.value);
    states.set(tunnelId, state);
    this.states$.next(states);
  }
}
