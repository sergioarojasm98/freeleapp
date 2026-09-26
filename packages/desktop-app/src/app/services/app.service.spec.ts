import { TestBed } from "@angular/core/testing";

import { AppService } from "./app.service";
import { mustInjected } from "../../base-injectables";

describe("AppService", () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [AppService].concat(mustInjected()),
    })
  );

  it("should be created", () => {
    const service: AppService = TestBed.inject(AppService);
    expect(service).toBeTruthy();
  });
});

describe("AppService SSM tool checks", () => {
  const installed = { "aws --version": "aws-cli/2.17.0", "session-manager-plugin --version": "1.2.650.0" };
  let available: { [command: string]: string };
  let toast: jasmine.Spy;

  const createService = () =>
    new AppService(
      { app: { getVersion: () => "1.0.0" } } as any,
      null,
      null,
      {
        logService: { log: () => {} },
        executeService: {
          execute: async (command: string) => {
            if (available[command] === undefined) {
              throw new Error(`${command}: command not found`);
            }
            return available[command];
          },
        },
      } as any,
      { toast } as any
    );
  const flush = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    toast = jasmine.createSpy("toast");
  });

  it("does not warn at startup when the Session Manager plugin is missing", async () => {
    available = { "aws --version": installed["aws --version"] };
    const service = createService();
    await flush();

    expect(toast).not.toHaveBeenCalled();
    expect(service.issueBody).toContain("| SsmPluginVersion | not installed |");
  });

  it("links to the requirements when the SSM dialog needs a missing tool", async () => {
    available = { "aws --version": installed["aws --version"] };
    const service = createService();

    expect(await service.checkSsmRequirements()).toBeFalse();
    expect(toast.calls.mostRecent().args[3]).toContain("/getting-started/requirements/#aws-systems-manager-optional");
  });

  it("finds a tool installed after startup without a restart", async () => {
    available = {};
    const service = createService();
    await flush();
    available = { ...installed };

    expect(await service.checkSsmRequirements()).toBeTrue();
    expect(service.issueBody).toContain("| SsmPluginVersion | 1.2.650.0 |");
    expect(toast).not.toHaveBeenCalled();
  });
});
