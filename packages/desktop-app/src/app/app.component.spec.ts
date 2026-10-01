import { TestBed, waitForAsync } from "@angular/core/testing";
import { RouterTestingModule } from "@angular/router/testing";
import { AppComponent } from "./app.component";
import { mustInjected } from "../base-injectables";
import { AppProviderService } from "./services/app-provider.service";
import { Workspace } from "@noovolari/leapp-core/models/workspace";
import { LoggedEntry, LogLevel } from "@noovolari/leapp-core/services/log-service";

describe("AppComponent", () => {
  beforeEach(waitForAsync(() => {
    const spyBehaviouralSubjectService = jasmine.createSpyObj("BehaviouralSubjectService", [], {
      sessions: [],
      sessions$: { subscribe: () => {} },
      workspaceExists: () => true,
      getWorkspace: () => new Workspace(),
      persistWorkspace: () => {},
    });
    const spyRepositoryService = jasmine.createSpyObj("Repository", {
      getProfiles: [],
      getSessions: [],
      createWorkspace: () => {},
      getWorkspace: (): Workspace => new Workspace(),
    });
    const spyLeappCoreService = jasmine.createSpyObj("LeappCoreService", [], {
      workspaceService: spyBehaviouralSubjectService,
      repository: spyRepositoryService,
      awsCoreService: { getRegions: () => [] },
      ssmTunnelService: { watchSessions: () => {}, stopOrphanTunnels: async () => {} },
    });

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [].concat(mustInjected().concat({ provide: AppProviderService, useValue: spyLeappCoreService })),
      declarations: [AppComponent],
    }).compileComponents();
  }));

  it("should create the app", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.debugElement.componentInstance;
    expect(app).toBeTruthy();

    (app as any).awsSsoRoleService = { setAwsIntegrationDelegate: () => {} };
    (app as any).windowService = { blockDevToolInProductionMode: () => {} };
    (app as any).updaterService = { createFoldersIfMissing: () => {} };
    (app as any).retroCompatibilityService = { applyWorkspaceMigrations: () => {} };
    (app as any).showCredentialBackupMessageIfNeeded = () => {};
    (app as any).manageAutoUpdate = () => {};
    (app as any).timerService = { start: () => {} };
    (app as any).loggingService = { log: () => {} };
    (app as any).behaviouralSubjectService = { fetchingIntegrationState$: { subscribe: () => {} } };
    (app as any).behaviouralSubjectService.sessions = [];
    (app as any).router = { navigate: jasmine.createSpy().and.returnValue(true) };

    (app as any).appNativeService = {
      os: {
        homedir: () => {},
      },
      path: {
        join: () => "",
      },
      ipcRenderer: { on: (_string, _callback) => {} },
      fs: { removeSync: () => {} },
    };

    await app.ngOnInit();
    expect((app as any).router.navigate).toHaveBeenCalledWith(["/dashboard"]);
  });

  it("Should listen for updates", () => {
    const fixture = TestBed.createComponent(AppComponent);
    let app = fixture.debugElement.componentInstance;

    (app as any).updaterService.getSavedAppVersion = jasmine.createSpy().and.throwError("error");
    (app as any).updaterService.getCurrentAppVersion = jasmine.createSpy().and.returnValue("0.0.0");

    // First try error
    expect(() => (app as any).manageAutoUpdate()).toThrowError("this.electronService.fs.writeFileSync is not a function");
    expect((app as any).updaterService.getCurrentAppVersion).toHaveBeenCalled();

    app = fixture.debugElement.componentInstance;
    (app as any).behaviouralSubjectService = { sessions: [] };

    (app as any).appProviderService = {};
    (app as any).appProviderService.sessionManagementService = {};
    (app as any).updaterService = {};
    (app as any).appNativeService = {};

    (app as any).appProviderService.sessionManagementService.updateSessions = jasmine.createSpy().and.returnValue("");
    (app as any).updaterService.getSavedAppVersion = jasmine.createSpy().and.returnValue("0.0.1");
    (app as any).updaterService.getCurrentAppVersion = jasmine.createSpy().and.returnValue("0.0.0");
    (app as any).updaterService.getReleaseNote = jasmine.createSpy().and.returnValue("release-note");
    (app as any).updaterService.setUpdateInfo = jasmine.createSpy().and.returnValue("");
    (app as any).updaterService.updateVersionJson = jasmine.createSpy().and.returnValue("");
    (app as any).updaterService.isUpdateNeeded = jasmine.createSpy().and.returnValue(true);
    (app as any).updaterService.updateDialog = jasmine.createSpy().and.returnValue("");

    const mockedCallback1 = () => {
      const releaseNote = (app as any).updaterService.getReleaseNote();
      (app as any).updaterService.setUpdateInfo("1", "2", "3", releaseNote);
      if ((app as any).updaterService.isUpdateNeeded()) {
        (app as any).updaterService.updateDialog();
        (app as any).behaviouralSubjectService.sessions = [...(app as any).behaviouralSubjectService.sessions];
        (app as any).appProviderService.sessionManagementService.updateSessions((app as any).behaviouralSubjectService.sessions);
      }
    };

    (app as any).appNativeService.ipcRenderer = {
      on: (_string, _callback) => {
        if (_string === "UPDATE_AVAILABLE") {
          mockedCallback1();
        }
      },
    };

    (app as any).manageAutoUpdate();
    expect((app as any).updaterService.getCurrentAppVersion).toHaveBeenCalled();

    const ipcRenderer = (app as any).appNativeService.ipcRenderer;
    ipcRenderer.on("UPDATE_AVAILABLE", null);
    expect((app as any).updaterService.getReleaseNote).toHaveBeenCalled();
    expect((app as any).updaterService.setUpdateInfo).toHaveBeenCalled();
    expect((app as any).updaterService.isUpdateNeeded).toHaveBeenCalled();
    expect((app as any).updaterService.updateDialog).toHaveBeenCalled();
    expect((app as any).appProviderService.sessionManagementService.updateSessions).toHaveBeenCalled();
  });

  it("beforeCloseInstructions", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.debugElement.componentInstance;
    (app as any).loggingService = { log: jasmine.createSpy().and.callFake(() => {}) };
    (app as any).appProviderService = {
      sessionManagementService: {
        stopAllSessions: jasmine.createSpy().and.callFake(() => {}),
      },
      ssmTunnelService: { stopAll: jasmine.createSpy() },
    };
    (app as any).appService = { quit: jasmine.createSpy().and.callFake(() => {}) };

    await (app as any).beforeCloseInstructions();

    expect((app as any).loggingService.log).toHaveBeenCalledWith(new LoggedEntry("Closing app with cleaning process...", this, LogLevel.info));
    expect((app as any).appProviderService.ssmTunnelService.stopAll).toHaveBeenCalledTimes(1);
    expect((app as any).appProviderService.sessionManagementService.stopAllSessions).toHaveBeenCalledTimes(1);
    expect((app as any).appService.quit).toHaveBeenCalledTimes(1);
  });
});
