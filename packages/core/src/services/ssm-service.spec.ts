import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { portForwardingCommand, ssmCommandForProfile, SsmService, validatePortForwarding } from "./ssm-service";
import { ExecuteService } from "./execute-service";
import { CredentialsInfo } from "../models/credentials-info";
import { INativeService } from "../interfaces/i-native-service";
import { LoggedEntry } from "./log-service";
import { LoggedException, LogLevel, LogService } from "./log-service";

jest.mock("../models/session");

describe("SsmService", () => {
  let ssmService: SsmService;
  let executeService: ExecuteService;
  let credentialInfo: CredentialsInfo;
  let mockedCallback: any;
  //let setConfig;
  let nativeService: INativeService;

  beforeEach(() => {
    credentialInfo = {
      sessionToken: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_access_key_id: "123",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_secret_access_key: "345",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        aws_session_token: "678",
      },
    };

    mockedCallback = jest.fn(() => {});
    //setConfig = jest.spyOn(SsmService, "setConfig");

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    executeService = {
      execute: jest.fn((_: string, _1?: boolean): Promise<string> => Promise.resolve("")),
      getQuote: jest.fn(() => ""),
      openTerminal: jest.fn((_: string, _1?: any): Promise<string> => Promise.resolve("")),
    };
    (executeService as any).nativeService = null;
    (executeService as any).repository = null;

    nativeService = {
      process: {
        platform: "",
      },
    } as any;

    ssmService = new SsmService(null, executeService, nativeService, null);
  });

  test("getSsmInstances - should retrieve a list of ssm sessions given a valid region", (done) => {
    (ssmService as any).applyEc2MetadataInformation = jest.fn((_: any): any => []);
    (ssmService as any).requestSsmInstances = jest.fn((_: any): any => []);

    ssmService.getSsmInstances(credentialInfo, "eu-west-1", mockedCallback);

    setTimeout(() => {
      expect(mockedCallback).toHaveBeenCalled();
      expect((ssmService as any).applyEc2MetadataInformation).toHaveBeenCalled();
      done();
    }, 100);
  });

  test("getSsmInstances - should call private method", (done) => {
    (ssmService as any).applyEc2MetadataInformation = jest.fn((_: any): any => []);
    (ssmService as any).requestSsmInstances = jest.fn((_: any): any => []);

    const mockedEc2Callback = jest.fn();

    ssmService.getSsmInstances(credentialInfo, "eu-west-1", mockedEc2Callback);

    setTimeout(() => {
      expect((ssmService as any).requestSsmInstances).toHaveBeenCalled();
      expect((ssmService as any).applyEc2MetadataInformation).toHaveBeenCalled();
      expect(mockedEc2Callback).toHaveBeenCalled();
      done();
    }, 100);
  });

  test("getSsmInstances - setFilteringForEc2CallsCallback not set", (done) => {
    (ssmService as any).applyEc2MetadataInformation = jest.fn((_: any): any => []);
    (ssmService as any).requestSsmInstances = jest.fn((_: any): any => []);

    ssmService.getSsmInstances(credentialInfo, "eu-west-1");

    setTimeout(() => {
      expect((ssmService as any).requestSsmInstances).toHaveBeenCalled();
      expect((ssmService as any).applyEc2MetadataInformation).toHaveBeenCalled();
      done();
    }, 100);
  });

  test("startSession - should start a ssm session by calling the execute service", (done) => {
    const env = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_ACCESS_KEY_ID: "123",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_SECRET_ACCESS_KEY: "345",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_SESSION_TOKEN: "678",
    };

    const region = "eu-west-1";
    const instanceId = "mocked-id";
    const quote = "";
    const logger = { log: jest.fn() };
    const logService = new LogService(logger as any);
    jest.spyOn(logService, "log");

    ssmService = new SsmService(logService as any, executeService, nativeService, null);

    ssmService.startSession(credentialInfo, instanceId, region);

    setTimeout(() => {
      expect(executeService.getQuote).toHaveBeenCalled();
      expect(executeService.openTerminal).toHaveBeenCalledWith(
        `aws ssm start-session --region ${region} --target ${quote}${instanceId}${quote}`,
        env,
        undefined
      );
      done();
      expect(logService.log).not.toHaveBeenCalled();
    }, 100);
  });

  test("startPortForwardingSession - opens a terminal with the port forwarding command", (done) => {
    const logService = new LogService({ log: jest.fn() } as any);
    ssmService = new SsmService(logService as any, executeService, nativeService, null);

    ssmService.startPortForwardingSession(credentialInfo, "i-096cb506adb838c72", "us-east-1", { remotePort: 15672, localPort: 17007 });

    setTimeout(() => {
      expect(executeService.openTerminal).toHaveBeenCalledWith(
        "aws ssm start-session --region us-east-1 --target i-096cb506adb838c72 --document-name AWS-StartPortForwardingSession" +
          " --parameters portNumber=15672,localPortNumber=17007",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        { AWS_ACCESS_KEY_ID: "123", AWS_SECRET_ACCESS_KEY: "345", AWS_SESSION_TOKEN: "678" },
        undefined
      );
      done();
    }, 100);
  });

  test("portForwardingCommand - to a remote host through the instance", () => {
    expect(
      portForwardingCommand("i-0c6bb0d9296e3cc2e", "us-west-2", {
        remoteHost: "batchengine-psql.clykg60eg5sn.us-west-2.rds.amazonaws.com",
        remotePort: 5432,
        localPort: 15454,
      })
    ).toBe(
      "aws ssm start-session --region us-west-2 --target i-0c6bb0d9296e3cc2e --document-name AWS-StartPortForwardingSessionToRemoteHost" +
        " --parameters host=batchengine-psql.clykg60eg5sn.us-west-2.rds.amazonaws.com,portNumber=5432,localPortNumber=15454"
    );
  });

  test("portForwardingCommand - rejects values that are not plain hosts and ports", () => {
    expect(() => portForwardingCommand("i-1", "us-east-1", { remoteHost: "db.local; rm -rf ~", remotePort: 5432, localPort: 5432 })).toThrow(
      "The remote host must be a host name or an IP address."
    );
  });

  test("ssmCommandForProfile - commands to paste in a terminal use the session's named profile", () => {
    expect(ssmCommandForProfile("i-0aa1", "us-east-1", "cogs-jo-prd")).toBe(
      "aws ssm start-session --region us-east-1 --target i-0aa1 --profile cogs-jo-prd"
    );
    expect(ssmCommandForProfile("i-0aa1", "us-east-1", "cogs-jo-prd", { remotePort: 15672, localPort: 17007 })).toBe(
      "aws ssm start-session --region us-east-1 --target i-0aa1 --document-name AWS-StartPortForwardingSession" +
        " --parameters portNumber=15672,localPortNumber=17007 --profile cogs-jo-prd"
    );
    expect(ssmCommandForProfile("i-0aa1", "us-east-1", "my profile's")).toBe(
      "aws ssm start-session --region us-east-1 --target i-0aa1 --profile 'my profile'\\''s'"
    );
  });

  test("caches instances per session and region, and remembers each session's last region", () => {
    ssmService = new SsmService({ log: jest.fn() } as any, executeService, nativeService, null);
    const instances = [{ ["InstanceId"]: "i-1" }];

    expect(ssmService.getCachedInstances("s1", "us-east-1")).toBeUndefined();
    ssmService.cacheInstances("s1", "us-east-1", instances);
    expect(ssmService.getCachedInstances("s1", "us-east-1").instances).toBe(instances);
    expect(ssmService.getCachedInstances("s1", "us-east-1").loadedAt).toBeInstanceOf(Date);
    expect(ssmService.getCachedInstances("s1", "eu-west-1")).toBeUndefined();
    expect(ssmService.getCachedInstances("s2", "us-east-1")).toBeUndefined();

    expect(ssmService.getLastRegion("s1")).toBeUndefined();
    ssmService.rememberRegion("s1", "us-west-2");
    expect(ssmService.getLastRegion("s1")).toBe("us-west-2");
  });

  test("validatePortForwarding", () => {
    expect(validatePortForwarding({ remotePort: 22, localPort: 2222 })).toBeUndefined();
    expect(validatePortForwarding({ remoteHost: "10.0.1.25", remotePort: 3306, localPort: 13306 })).toBeUndefined();
    expect(validatePortForwarding({ remoteHost: "-bad", remotePort: 22, localPort: 2222 })).toBe(
      "The remote host must be a host name or an IP address."
    );
    expect(validatePortForwarding({ remotePort: 0, localPort: 2222 })).toBe("The remote port must be a number from 1 to 65535.");
    expect(validatePortForwarding({ remotePort: 22, localPort: 70000 })).toBe("The local port must be a number from 1 to 65535.");
    expect(validatePortForwarding({ remotePort: 22.5, localPort: 2222 })).toBe("The remote port must be a number from 1 to 65535.");
  });

  test("startSession - on macOS, should create the env file, start an ssm session, and then remove the file", (done) => {
    const env = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_ACCESS_KEY_ID: "123",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_SECRET_ACCESS_KEY: "345",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      AWS_SESSION_TOKEN: "678",
    };

    const mockedHomeDir = "/Users/mock";
    const path = `${mockedHomeDir}/.freeleapp/ssm-env`;
    const mockedFileContent = `export AWS_SESSION_TOKEN=${env.AWS_SESSION_TOKEN} &&
          export AWS_SECRET_ACCESS_KEY=${env.AWS_SECRET_ACCESS_KEY} &&
          export AWS_ACCESS_KEY_ID=${env.AWS_ACCESS_KEY_ID}`;
    const fileService = {
      writeFileSync: jest.fn(() => {}),
    } as any;

    nativeService = {
      process: {
        platform: "darwin",
      },
      os: {
        homedir: () => mockedHomeDir,
      },
      rimraf: jest.fn(),
    } as any;

    ssmService = new SsmService(null, executeService, nativeService, fileService);

    const instanceId = "mocked-id";
    const region = "eu-west-1";
    const quote = "";

    ssmService.startSession(credentialInfo, instanceId, region);

    setTimeout(() => {
      expect(fileService.writeFileSync).toHaveBeenCalledWith(path, mockedFileContent);
      expect(executeService.getQuote).toHaveBeenCalled();
      expect(executeService.openTerminal).toHaveBeenCalledWith(
        `aws ssm start-session --region ${region} --target ${quote}${instanceId}${quote}`,
        env,
        undefined
      );
      expect(nativeService.rimraf).toHaveBeenCalledWith(path, {}, expect.any(Function));
      done();
    }, 100);
  });

  test("startSession - openTerminal throws an error and on macOS the env file is removed", (done) => {
    jest.useFakeTimers();

    const mockedHomeDir = "/Users/mock";
    const fileService = {
      writeFileSync: jest.fn(() => {}),
    } as any;
    const executeService2 = {
      getQuote: () => {},
      openTerminal: jest.fn((_1: any, _2: any, _3: any) => ({ ["then"]: jest.fn(() => ({ ["catch"]: (clb) => clb({ message: "error" }) })) })),
    } as any;
    const nativeService2 = {
      process: {
        platform: "darwin",
      },
      os: {
        homedir: () => mockedHomeDir,
      },
      rimraf: jest.fn(() => {}),
    } as any;
    const logger = { log: jest.fn(), show: jest.fn() };
    const logService = new LogService(logger as any);
    jest.spyOn(logService, "log");
    ssmService = new SsmService(logService as any, executeService2, nativeService2, fileService);
    const instanceId = "mocked-id";
    const region = "eu-west-1";

    ssmService.startSession(credentialInfo, instanceId, region);
    setTimeout(() => {
      expect(nativeService2.rimraf).toHaveBeenCalled();
      expect(logService.log).toHaveBeenCalledWith(new LoggedException("error", this, LogLevel.error, true));
      const nativeService3 = {
        process: {
          platform: "not-darwin",
        },
        os: {
          homedir: () => mockedHomeDir,
        },
        rimraf: jest.fn(),
      } as any;
      const ssmService2 = new SsmService(logService as any, executeService2, nativeService3, fileService);
      ssmService2.startSession(credentialInfo, instanceId, region);

      expect(logService.log).toHaveBeenCalledWith(new LoggedException("error", this, LogLevel.error, true));
      expect(nativeService3.rimraf).not.toHaveBeenCalled();
      done();
    }, 200);
    jest.runAllTimers();
  });

  test("requestSsmInstances, plus error checking", async () => {
    const logService: any = {
      log: jest.fn(),
    };

    ssmService = new SsmService(logService, executeService, nativeService, null);
    const instanceId = "mocked-id";
    const region = "eu-west-1";

    let index = 0;
    (ssmService as any).ssmClient = {
      send: jest.fn(async () =>
        Promise.resolve({
          // eslint-disable-next-line @typescript-eslint/naming-convention
          InstanceInformationList: [
            {
              fakeInstanceId: "fake-id-1",
              // eslint-disable-next-line @typescript-eslint/naming-convention
              PingStatus: "Offline",
            },
            {
              fakeInstanceId: "fake-id-2",
              // eslint-disable-next-line @typescript-eslint/naming-convention
              PingStatus: "Online",
            },
          ],
          // eslint-disable-next-line @typescript-eslint/naming-convention
          NextToken: index++ < 3 ? "fake-next-token" : undefined,
        })
      ),
    };

    jest.spyOn(ssmService as any, "requestSsmInstances");
    const result = await (ssmService as any).requestSsmInstances(credentialInfo, instanceId, region);
    expect(logService.log).toHaveBeenCalledWith(new LoggedEntry("Obtained smm info from aws for SSM", ssmService, LogLevel.info));
    expect((ssmService as any).ssmClient.send).toHaveBeenCalledTimes(4);

    const resultObject = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      Name: undefined,
      fakeInstanceId: "fake-id-2",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      PingStatus: "Online",
    };
    expect(result).toStrictEqual([resultObject, resultObject, resultObject, resultObject]);

    (ssmService as any).ssmClient = {
      send: jest.fn(async () =>
        Promise.resolve({
          // eslint-disable-next-line @typescript-eslint/naming-convention
          InstanceInformationList: [
            {
              fakeInstanceId: "fake-id-1",
              // eslint-disable-next-line @typescript-eslint/naming-convention
              PingStatus: "Offline",
            },
            {
              fakeInstanceId: "fake-id-2",
              // eslint-disable-next-line @typescript-eslint/naming-convention
              PingStatus: "Offline",
            },
          ],
        })
      ),
    };

    await expect(async () => {
      await (ssmService as any).requestSsmInstances(credentialInfo, instanceId, region);
    }).rejects.toThrow(new Error("No instances are accessible by this Role."));

    (ssmService as any).ssmClient = {
      send: jest.fn(async () => Promise.resolve({})),
    };

    await expect(async () => {
      await (ssmService as any).requestSsmInstances(credentialInfo, instanceId, region);
    }).rejects.toThrow(new Error("No instances are accessible by this Role."));
  });

  test("applyEc2MetadataInformation - names, running state and order from EC2", async () => {
    /* eslint-disable @typescript-eslint/naming-convention */
    const ssmInstances = [
      { InstanceId: "i-3", Name: "i-3", IPAddress: "10.0.0.3" },
      { InstanceId: "i-1", Name: "i-1", IPAddress: "10.0.0.1" },
      { InstanceId: "i-2", Name: "i-2", IPAddress: "10.0.0.2" },
      { InstanceId: "i-stopped", Name: "i-stopped" },
      { InstanceId: "mi-onprem", Name: "mi-onprem" },
    ];
    const pages = [
      {
        Reservations: [
          {
            // Launched together: every instance of the reservation must be named, not just the first one
            Instances: [
              { InstanceId: "i-1", State: { Name: "running" }, Tags: [{ Key: "Name", Value: "rabbitmq" }] },
              { InstanceId: "i-2", State: { Name: "running" }, Tags: [{ Key: "Name", Value: "api" }] },
            ],
          },
        ],
        NextToken: "page-2",
      },
      {
        Reservations: [
          { Instances: [{ InstanceId: "i-3", State: { Name: "running" } }] },
          { Instances: [{ InstanceId: "i-stopped", State: { Name: "stopped" }, Tags: [{ Key: "Name", Value: "old" }] }] },
        ],
      },
    ];
    /* eslint-enable @typescript-eslint/naming-convention */
    ssmService = new SsmService({ log: jest.fn() } as any, executeService, nativeService, null);
    (ssmService as any).ec2Client = { send: jest.fn(async () => pages.shift()) };

    const result = await (ssmService as any).applyEc2MetadataInformation(ssmInstances);

    expect(result.map((instance) => [instance.InstanceId, instance.Name, instance.HasName])).toEqual([
      ["i-2", "api", true],
      ["i-1", "rabbitmq", true],
      ["i-3", "i-3", false],
      ["mi-onprem", "mi-onprem", false],
    ]);
  });

  test("applyEc2MetadataInformation - EC2 errors are reported", async () => {
    ssmService = new SsmService({ log: jest.fn() } as any, executeService, nativeService, null);
    (ssmService as any).ec2Client = {
      send: jest.fn(async () => {
        throw new Error("UnauthorizedOperation");
      }),
    };

    await expect((ssmService as any).applyEc2MetadataInformation([])).rejects.toThrow("UnauthorizedOperation");
  });

  test("log service completion - must be done here because it seems that for jest --coverage the file is tied here...", () => {
    const logger = { log: jest.fn(), show: jest.fn() };
    let logService = new LogService(logger as any);

    logService.log(new LoggedEntry("message", this, LogLevel.info, false));
    expect(logger.log).toHaveBeenCalled();

    logService = new LogService(logger as any);
    logService.log(new LoggedEntry("message", this, LogLevel.warn, false));
    expect(logger.log).toHaveBeenCalled();

    logService = new LogService(logger as any);
    logService.log(new LoggedEntry("message", this, LogLevel.success, false));
    expect(logger.log).toHaveBeenCalled();

    logService = new LogService(logger as any);
    logService.log(new LoggedException("message", this, LogLevel.error, false));
    expect(logger.log).toHaveBeenCalled();

    logService = new LogService(logger as any);
    logService.log(new LoggedEntry("message", this, LogLevel.success, true));
    expect(logger.log).toHaveBeenCalled();
    expect(logger.show).toHaveBeenCalled();
  });
});
