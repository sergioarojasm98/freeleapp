import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { EventEmitter } from "events";
import * as net from "net";
import { BehaviorSubject } from "rxjs";
import { reconnectDelaysMs, SsmTunnelService } from "./ssm-tunnel-service";
import { SsmTunnel, SsmTunnelStatus } from "../models/ssm-tunnel";
import { SessionStatus } from "../models/session-status";

class FakeProcess extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = jest.fn();

  listen(): void {
    this.stdout.emit("data", "Starting session with SessionId: s-1\nPort 17007 opened for sessionId s-1.\nWaiting for connections...\n");
  }

  exit(code: number, stderr?: string): void {
    if (stderr) {
      this.stderr.emit("data", stderr);
    }
    this.exitCode = code;
    this.emit("close", code);
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe("SsmTunnelService", () => {
  const tunnel: SsmTunnel = {
    id: "t1",
    name: "RabbitMQ",
    sessionId: "session-1",
    instanceId: "i-096cb506adb838c72",
    instanceName: "rabbitmq-prod-1",
    region: "us-east-1",
    remotePort: 15672,
    localPort: 17007,
    autoStart: true,
  };
  const credentials = (n: number) => ({
    sessionToken: { ["aws_access_key_id"]: `key-${n}`, ["aws_secret_access_key"]: `secret-${n}`, ["aws_session_token"]: `token-${n}` },
  });

  let processes: FakeProcess[];
  let nativeService: any;
  let sessionService: any;
  let service: SsmTunnelService;
  let sessions$: BehaviorSubject<any[]>;
  let portFree: boolean;
  let registry: string;
  let commands: Record<string, string>;

  beforeEach(() => {
    processes = [];
    portFree = true;
    registry = "[]";
    commands = {};
    let generated = 0;
    sessionService = { generateCredentials: jest.fn(async () => credentials(++generated)) };
    nativeService = {
      process: { env: { ["PATH"]: "/usr/bin:/bin", ["AWS_PROFILE"]: "someone-else", ["HOME"]: "/Users/me" }, kill: jest.fn() },
      fs: {
        existsSync: jest.fn((path: string) => path === "/opt/homebrew/bin/aws"),
        readFileSync: jest.fn(() => registry),
        writeFileSync: jest.fn((_path: string, content: string) => (registry = content)),
      },
      os: { homedir: () => "/Users/me" },
      exec: jest.fn((_command: string, callback: any) => callback(null, commands[_command] ?? "")),
      spawn: jest.fn(() => {
        const process = new FakeProcess();
        processes.push(process);
        return process;
      }),
      net: {
        createServer: () => {
          const server = new EventEmitter() as any;
          server.listen = () => setImmediate(() => server.emit(portFree ? "listening" : "error", new Error("EADDRINUSE")));
          server.close = (callback: () => void) => callback();
          return server;
        },
      },
    };
    const repository = {
      listSsmTunnels: () => [tunnel],
      getSessionById: () => ({ sessionId: "session-1", type: "awsSsoRole" }),
    } as any;
    const sessionFactory = { getSessionService: () => sessionService } as any;
    sessions$ = new BehaviorSubject<any[]>([]);
    service = new SsmTunnelService(repository, sessionFactory, nativeService, { log: jest.fn() } as any, { sessions$ } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("start - runs the AWS CLI with fresh credentials and becomes active when the port listens", async () => {
    await service.start("t1");

    expect(nativeService.spawn).toHaveBeenCalledTimes(1);
    const [binary, args, options] = nativeService.spawn.mock.calls[0];
    expect(binary).toBe("/opt/homebrew/bin/aws");
    expect(args).toEqual([
      "ssm",
      "start-session",
      "--region",
      "us-east-1",
      "--target",
      "i-096cb506adb838c72",
      "--document-name",
      "AWS-StartPortForwardingSession",
      "--parameters",
      "portNumber=15672,localPortNumber=17007",
    ]);
    expect(options.detached).toBe(true);
    expect(options.env.AWS_ACCESS_KEY_ID).toBe("key-1");
    expect(options.env.AWS_SESSION_TOKEN).toBe("token-1");
    expect(options.env.AWS_PROFILE).toBeUndefined();
    expect(options.env.PATH.split(":")).toEqual(expect.arrayContaining(["/usr/bin", "/opt/homebrew/bin", "/usr/local/sessionmanagerplugin/bin"]));
    expect(service.getState("t1").status).toBe(SsmTunnelStatus.starting);

    processes[0].listen();

    expect(service.getState("t1").status).toBe(SsmTunnelStatus.active);
    expect(service.getState("t1").activeSince).toBeDefined();
    expect(service.runningCount).toBe(1);
  });

  test("start - fails without starting the AWS CLI when the local port is in use", async () => {
    portFree = false;

    await service.start("t1");

    expect(nativeService.spawn).not.toHaveBeenCalled();
    expect(service.getState("t1")).toEqual({
      status: SsmTunnelStatus.failed,
      message: "Local port 17007 is already in use. Stop what uses it, or edit the tunnel to use another port.",
    });
    expect(service.isRunning("t1")).toBe(false);
  });

  test("start - fails when the session cannot give credentials", async () => {
    sessionService.generateCredentials = jest.fn(async () => {
      throw new Error("the integration needs to sign in again");
    });

    await service.start("t1");

    expect(service.getState("t1")).toEqual({
      status: SsmTunnelStatus.failed,
      message: "Could not get credentials for the session: the integration needs to sign in again",
    });
  });

  test("a tunnel that exits before listening fails with the last error line", async () => {
    await service.start("t1");

    processes[0].exit(255, "\nAn error occurred (TargetNotConnected) when calling the StartSession operation: i-096 is not connected.\n");

    expect(service.getState("t1")).toEqual({
      status: SsmTunnelStatus.failed,
      message: "An error occurred (TargetNotConnected) when calling the StartSession operation: i-096 is not connected.",
    });
    expect(nativeService.spawn).toHaveBeenCalledTimes(1);
  });

  test("a tunnel that drops reconnects with new credentials, and gives up after three attempts", async () => {
    await service.start("t1");
    // After the port check, which waits for a real macrotask
    jest.useFakeTimers();
    processes[0].listen();

    processes[0].exit(0, "Connection closed\n");
    expect(service.getState("t1").status).toBe(SsmTunnelStatus.reconnecting);
    expect(service.getState("t1").message).toBe("Connection lost (Connection closed). Reconnecting, attempt 1 of 3.");

    jest.advanceTimersByTime(reconnectDelaysMs[0]);
    await flush();
    expect(nativeService.spawn).toHaveBeenCalledTimes(2);
    expect(nativeService.spawn.mock.calls[1][2].env.AWS_SESSION_TOKEN).toBe("token-2");

    // Listening again resets the attempts
    processes[1].listen();
    expect(service.getState("t1").status).toBe(SsmTunnelStatus.active);
    processes[1].exit(0);
    expect(service.getState("t1").message).toBe("Connection lost. Reconnecting, attempt 1 of 3.");

    for (let attempt = 0; attempt < reconnectDelaysMs.length; attempt++) {
      jest.advanceTimersByTime(reconnectDelaysMs[attempt]);
      await flush();
      processes[processes.length - 1].exit(255, "Could not connect\n");
    }

    expect(service.getState("t1")).toEqual({ status: SsmTunnelStatus.failed, message: "Could not connect" });
    expect(service.isRunning("t1")).toBe(false);
  });

  test("stop - ends the whole process group and does not reconnect", async () => {
    await service.start("t1");
    processes[0].listen();

    service.stop("t1");
    expect(nativeService.process.kill).toHaveBeenCalledWith(-4242, "SIGTERM");

    processes[0].exit(0);
    expect(service.getState("t1").status).toBe(SsmTunnelStatus.stopped);
    expect(service.isRunning("t1")).toBe(false);
    expect(nativeService.spawn).toHaveBeenCalledTimes(1);
  });

  test("stop - while waiting to reconnect cancels the attempt", async () => {
    await service.start("t1");
    // After the port check, which waits for a real macrotask
    jest.useFakeTimers();
    processes[0].listen();
    processes[0].exit(0);

    service.stop("t1");
    jest.advanceTimersByTime(reconnectDelaysMs[0]);
    await flush();

    expect(service.getState("t1").status).toBe(SsmTunnelStatus.stopped);
    expect(nativeService.spawn).toHaveBeenCalledTimes(1);
  });

  test("records the process of each running tunnel, and forgets it when it ends", async () => {
    await service.start("t1");
    expect(JSON.parse(registry)).toEqual([4242]);

    service.stop("t1");
    processes[0].exit(0);
    expect(JSON.parse(registry)).toEqual([]);
    expect(nativeService.fs.writeFileSync.mock.calls[0][0]).toBe("/Users/me/.freeleapp/ssm-tunnels.pids");
  });

  test("stopOrphanTunnels - stops tunnels left by a previous run, and nothing else", async () => {
    registry = "[101, 202, 303, 404]";
    commands = {
      ["ps -A -o pgid=,command="]: [
        "    1 /sbin/launchd",
        "  101 /usr/local/bin/aws ssm start-session --region us-east-1 --target i-1 --document-name x",
        "  101 session-manager-plugin {...} us-east-1 StartSession",
        // The AWS CLI of this group is gone, its plugin still holds the port
        "  404 session-manager-plugin {...} us-west-2 StartSession",
        // The group id was reused by something else
        "  202 /Applications/Safari.app/Contents/MacOS/Safari",
      ].join("\n"),
    };
    // Group 303 no longer exists
    nativeService.process.kill = jest.fn((pid: number, signal: any) => {
      if (pid === -303 && signal === 0) {
        throw new Error("ESRCH");
      }
    });

    await service.stopOrphanTunnels();

    expect(nativeService.process.kill).toHaveBeenCalledWith(-101, "SIGTERM");
    expect(nativeService.process.kill).toHaveBeenCalledWith(-404, "SIGTERM");
    expect(nativeService.process.kill).not.toHaveBeenCalledWith(-202, "SIGTERM");
    expect(nativeService.process.kill).not.toHaveBeenCalledWith(-303, "SIGTERM");
    expect(JSON.parse(registry)).toEqual([]);
  });

  test("a tunnel whose AWS CLI exits also ends the rest of its process group", async () => {
    await service.start("t1");
    processes[0].exit(255, "boom\n");

    expect(nativeService.process.kill).toHaveBeenCalledWith(-4242, "SIGTERM");
  });

  test("restart - stops the running tunnel and starts it again", async () => {
    await service.start("t1");
    processes[0].listen();

    const restarting = service.restart("t1");
    expect(nativeService.process.kill).toHaveBeenCalledWith(-4242, "SIGTERM");
    processes[0].exit(0);
    await restarting;

    expect(nativeService.spawn).toHaveBeenCalledTimes(2);
    processes[1].listen();
    expect(service.getState("t1").status).toBe(SsmTunnelStatus.active);
  });

  test("watchSessions - starts auto-start tunnels when their session becomes active", async () => {
    service.watchSessions();
    sessions$.next([{ sessionId: "session-1", status: SessionStatus.inactive }]);
    expect(nativeService.spawn).not.toHaveBeenCalled();

    sessions$.next([{ sessionId: "session-1", status: SessionStatus.active }]);
    await flush();
    await new Promise((resolve) => setImmediate(resolve));
    await flush();

    expect(nativeService.spawn).toHaveBeenCalledTimes(1);
  });

  test("watchSessions - does not start tunnels for sessions already active when the app opens", async () => {
    service.watchSessions();
    sessions$.next([{ sessionId: "session-1", status: SessionStatus.active }]);
    await flush();

    expect(nativeService.spawn).not.toHaveBeenCalled();
  });

  test("suggestLocalPort and isLocalPortFree use real sockets", async () => {
    nativeService.net = net;

    const port = await service.suggestLocalPort();
    expect(port).toBeGreaterThan(1023);
    expect(await service.isLocalPortFree(port)).toBe(true);

    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
    expect(await service.isLocalPortFree(port)).toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
