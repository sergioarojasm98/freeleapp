import { ExecuteService } from "./execute-service";
import { CredentialsInfo } from "../models/credentials-info";
import { LoggedEntry, LoggedException, LogLevel, LogService } from "./log-service";
import { constants } from "../models/constants";
import { INativeService } from "../interfaces/i-native-service";
import { FileService } from "./file-service";
import { DescribeInstanceInformationCommand, SSMClient } from "@aws-sdk/client-ssm";
import { DescribeInstancesCommand, EC2Client } from "@aws-sdk/client-ec2";

export interface SsmPortForwarding {
  // Host the instance forwards to; the instance itself when empty
  remoteHost?: string;
  remotePort: number;
  localPort: number;
}

const isPort = (port: number): boolean => Number.isInteger(port) && port >= 1 && port <= 65535;

/**
 * Check a port forwarding request. The values end up in a shell command inside an AppleScript string, so only
 * plain ports and host names (letters, digits, dots and hyphens) are accepted.
 *
 * @returns the problem to show, or undefined when the request is valid
 */
export const validatePortForwarding = (forwarding: SsmPortForwarding): string | undefined => {
  if (forwarding.remoteHost && !/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(forwarding.remoteHost)) {
    return "The remote host must be a host name or an IP address.";
  }
  if (!isPort(forwarding.remotePort)) {
    return "The remote port must be a number from 1 to 65535.";
  }
  if (!isPort(forwarding.localPort)) {
    return "The local port must be a number from 1 to 65535.";
  }
  return undefined;
};

/**
 * The AWS CLI arguments (after "aws") for a port forwarding session. Parameters use the CLI shorthand syntax, which
 * needs no quotes.
 */
export const portForwardingArgs = (instanceId: string, region: string, forwarding: SsmPortForwarding): string[] => {
  const problem = validatePortForwarding(forwarding);
  if (problem) {
    throw new Error(problem);
  }
  const ports = `portNumber=${forwarding.remotePort},localPortNumber=${forwarding.localPort}`;
  const [document, parameters] = forwarding.remoteHost
    ? ["AWS-StartPortForwardingSessionToRemoteHost", `host=${forwarding.remoteHost},${ports}`]
    : ["AWS-StartPortForwardingSession", ports];
  return ["ssm", "start-session", "--region", region, "--target", instanceId, "--document-name", document, "--parameters", parameters];
};

/**
 * The AWS CLI command for a port forwarding session
 */
export const portForwardingCommand = (instanceId: string, region: string, forwarding: SsmPortForwarding): string =>
  ["aws", ...portForwardingArgs(instanceId, region, forwarding)].join(" ");

// Quotes a named profile for a shell when it has characters the shell would split or expand
const shellWord = (word: string): string => (/^[A-Za-z0-9._@%+=:,/-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`);

/**
 * A command to paste in any terminal: it uses the session's named profile, which works while the session is active
 *
 * @param instanceId - the instance to connect to
 * @param region - the region of the instance
 * @param profileName - the named profile of the session
 * @param forwarding - a port forwarding, or none for a shell session
 */
export const ssmCommandForProfile = (instanceId: string, region: string, profileName: string, forwarding?: SsmPortForwarding): string => {
  const command = forwarding
    ? portForwardingCommand(instanceId, region, forwarding)
    : `aws ssm start-session --region ${region} --target ${instanceId}`;
  return `${command} --profile ${shellWord(profileName)}`;
};

export interface CachedSsmInstances {
  instances: any[];
  loadedAt: Date;
}

export class SsmService {
  ssmClient: SSMClient;
  ec2Client: EC2Client;

  // Instances already listed, by session and region, and the last region used by each session, while the app runs
  private instanceCache = new Map<string, CachedSsmInstances>();
  private lastRegions = new Map<string, string>();

  constructor(
    private logService: LogService,
    private executeService: ExecuteService,
    private nativeService: INativeService,
    private fileService: FileService
  ) {}

  /**
   * Set the config for the SSM client
   *
   * @param data - the credential information
   * @param region - the region for the client
   */
  static setConfig(data: CredentialsInfo, region: string): any {
    return {
      region,
      accessKeyId: data.sessionToken.aws_access_key_id,
      secretAccessKey: data.sessionToken.aws_secret_access_key,
      sessionToken: data.sessionToken.aws_session_token,
    };
  }

  /**
   * Prepare the two clients and returns the available
   * ssm instances for the selected region
   *
   * @param credentials - pass the credentials object
   * @param region - pass the region where you want to make the request
   * @returns - {Observable<SsmResult>} - return the list of instances capable of SSM in the selected region
   */
  async getSsmInstances(credentials: CredentialsInfo, region: string, setFilteringForEc2CallsCallback?: any): Promise<any> {
    // Set your SSM client and EC2 client
    this.ssmClient = new SSMClient({
      region,
      credentials: {
        accessKeyId: credentials.sessionToken.aws_access_key_id,
        secretAccessKey: credentials.sessionToken.aws_secret_access_key,
        sessionToken: credentials.sessionToken.aws_session_token,
      },
    });
    this.ec2Client = new EC2Client({
      region,
      credentials: {
        accessKeyId: credentials.sessionToken.aws_access_key_id,
        secretAccessKey: credentials.sessionToken.aws_secret_access_key,
        sessionToken: credentials.sessionToken.aws_session_token,
      },
    });

    // Fix for Ec2 clients from electron app
    // TODO: find a way to inject the origin header without using setFilteringForEc2Calls
    if (setFilteringForEc2CallsCallback) {
      setFilteringForEc2CallsCallback();
    }

    // Get Ssm instances info data
    const instances = await this.requestSsmInstances();
    return await this.applyEc2MetadataInformation(instances);
  }

  getCachedInstances(sessionId: string, region: string): CachedSsmInstances | undefined {
    return this.instanceCache.get(`${sessionId}|${region}`);
  }

  cacheInstances(sessionId: string, region: string, instances: any[]): void {
    this.instanceCache.set(`${sessionId}|${region}`, { instances, loadedAt: new Date() });
  }

  getLastRegion(sessionId: string): string | undefined {
    return this.lastRegions.get(sessionId);
  }

  rememberRegion(sessionId: string, region: string): void {
    this.lastRegions.set(sessionId, region);
  }

  /**
   * Start a new ssm session given the instance id
   *
   * @param credentials - CredentialsInfo data from generate credentials method
   * @param instanceId - the instance id of the instance to start
   * @param region - aws System Manager start a session from a defined region
   * @param macOsTerminalType - optional to override terminal type selection on macOS
   */
  startSession(credentials: CredentialsInfo, instanceId: string, region: string, macOsTerminalType?: string): void {
    const quote = this.executeService.getQuote();
    this.openSsmTerminal(credentials, `aws ssm start-session --region ${region} --target ${quote}${instanceId}${quote}`, macOsTerminalType);
  }

  /**
   * Start a port forwarding session: a local port reaches a port on the instance, or on a host the instance can reach
   * (e.g. a database endpoint). It runs in a terminal window, and stops when that command is interrupted.
   *
   * @param credentials - CredentialsInfo data from generate credentials method
   * @param instanceId - the instance that forwards the traffic
   * @param region - the region of the instance
   * @param forwarding - remote host (optional), remote port and local port
   * @param macOsTerminalType - optional to override terminal type selection on macOS
   */
  startPortForwardingSession(
    credentials: CredentialsInfo,
    instanceId: string,
    region: string,
    forwarding: SsmPortForwarding,
    macOsTerminalType?: string
  ): void {
    this.openSsmTerminal(credentials, portForwardingCommand(instanceId, region, forwarding), macOsTerminalType);
  }

  private openSsmTerminal(credentials: CredentialsInfo, command: string, macOsTerminalType?: string): void {
    const env = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_ACCESS_KEY_ID: credentials.sessionToken.aws_access_key_id,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_SECRET_ACCESS_KEY: credentials.sessionToken.aws_secret_access_key,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_SESSION_TOKEN: credentials.sessionToken.aws_session_token,
    };

    if (this.nativeService.process.platform === "darwin") {
      // Creates the ssm-set-env file for the openTerminal
      const exportedEnvVars = `export AWS_SESSION_TOKEN=${env.AWS_SESSION_TOKEN} &&
          export AWS_SECRET_ACCESS_KEY=${env.AWS_SECRET_ACCESS_KEY} &&
          export AWS_ACCESS_KEY_ID=${env.AWS_ACCESS_KEY_ID}`;
      this.fileService.writeFileSync(this.nativeService.os.homedir() + "/" + constants.ssmSourceFileDestination, exportedEnvVars);
    }

    this.executeService
      .openTerminal(command, env, macOsTerminalType)
      .then(() => {
        if (this.nativeService.process.platform === "darwin")
          this.nativeService.rimraf(this.nativeService.os.homedir() + "/" + constants.ssmSourceFileDestination, {}, () => {});
      })
      .catch((err) => {
        if (this.nativeService.process.platform === "darwin") {
          this.nativeService.rimraf(this.nativeService.os.homedir() + "/" + constants.ssmSourceFileDestination, {}, () => {});
        }
        this.logService.log(new LoggedException(err.message, this, LogLevel.error, true));
      });
  }

  /**
   * Submit the request to do ssm to aws
   */
  private async requestSsmInstances(): Promise<any> {
    let tmpInstances = [];
    let instances = [];
    let nextToken = null;

    try {
      do {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const input = { MaxResults: 50, NextToken: nextToken };
        const command = new DescribeInstanceInformationCommand(input);

        const describeInstanceInformationResponse = await this.ssmClient.send(command);
        // eslint-disable-next-line max-len
        if (
          describeInstanceInformationResponse["InstanceInformationList"] &&
          describeInstanceInformationResponse["InstanceInformationList"].length > 0
        ) {
          tmpInstances = describeInstanceInformationResponse["InstanceInformationList"].filter((i) => i.PingStatus === "Online");
          if (tmpInstances.length > 0) {
            instances = instances.concat(tmpInstances);
          }
        }
        nextToken = describeInstanceInformationResponse.NextToken;
      } while (nextToken);

      if (instances.length > 0) {
        instances.forEach((instance) => {
          // Replaced by the EC2 Name tag when the instance has one
          instance["Name"] = instance.InstanceId;
        });

        // We have found and managed a list of instances
        this.logService.log(new LoggedEntry("Obtained smm info from aws for SSM", this, LogLevel.info));
        return instances;
      } else {
        // No instances usable
        throw new Error("No instances are accessible by this Role.");
      }
    } catch (err) {
      throw new LoggedException(err.message, this, LogLevel.warn);
    }
  }

  /**
   * Names each instance after its EC2 Name tag, drops the ones EC2 reports as not running, and sorts them: named ones
   * first, by name, then the others by id. Instances EC2 does not know (e.g. on-premises nodes) are kept.
   */
  private async applyEc2MetadataInformation(instances: any[]): Promise<any[]> {
    const ec2Instances = new Map<string, any>();
    let nextToken = null;

    try {
      do {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const input = { MaxResults: 100, NextToken: nextToken };
        const command = new DescribeInstancesCommand(input);
        const describeInstanceResponse = await this.ec2Client.send(command);

        // A reservation holds every instance launched together, not just one
        for (const reservation of describeInstanceResponse.Reservations ?? []) {
          for (const ec2Instance of reservation.Instances ?? []) {
            ec2Instances.set(ec2Instance.InstanceId, ec2Instance);
          }
        }
        nextToken = describeInstanceResponse.NextToken;
      } while (nextToken);
    } catch (err) {
      throw new LoggedException(err.message, this, LogLevel.warn);
    }

    return instances
      .filter((instance) => {
        const state = ec2Instances.get(instance.InstanceId)?.State?.Name;
        return !state || state === "running";
      })
      .map((instance) => {
        const nameTag = ec2Instances.get(instance.InstanceId)?.Tags?.find((tag) => tag.Key === "Name")?.Value;
        instance.Name = nameTag || instance.InstanceId;
        instance.HasName = !!nameTag;
        return instance;
      })
      .sort((a, b) => (a.HasName === b.HasName ? a.Name.localeCompare(b.Name) : a.HasName ? -1 : 1));
  }
}
