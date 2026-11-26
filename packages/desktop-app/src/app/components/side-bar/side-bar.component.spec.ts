import { BehaviorSubject } from "rxjs";
import { ComponentFixture, TestBed } from "@angular/core/testing";

import { SideBarComponent } from "./side-bar.component";
import { mustInjected } from "../../../base-injectables";
import { AppProviderService } from "../../services/app-provider.service";
import { MatMenuModule } from "@angular/material/menu";
import { RouterTestingModule } from "@angular/router/testing";
import { globalFilterGroup, globalResetFilter } from "../command-bar/command-bar.component";
import { SessionStatus } from "@noovolari/leapp-core/models/session-status";

describe("SideBarComponent", () => {
  let component: SideBarComponent;
  let fixture: ComponentFixture<SideBarComponent>;

  beforeEach(async () => {
    const spyRepositoryService = jasmine.createSpyObj("Repository", {
      getProfiles: [],
      getSessions: [],
      getSegments: [],
    });
    const spyLeappCoreService = jasmine.createSpyObj("LeappCoreService", [], {
      repository: spyRepositoryService,
      segmentService: { list: () => [] },
      awsCoreService: { getRegions: () => [] },
      behaviouralSubjectService: { sessions: [], sessions$: new BehaviorSubject([]), unselectSessions: () => {} },
      ssmTunnelService: { states$: new BehaviorSubject(new Map()), runningCount: 0 },
    });

    await TestBed.configureTestingModule({
      declarations: [SideBarComponent],
      imports: [MatMenuModule, RouterTestingModule],
      providers: [].concat(mustInjected().concat({ provide: AppProviderService, useValue: spyLeappCoreService })),
    }).compileComponents();

    fixture = TestBed.createComponent(SideBarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    (component as any).unsubscribe = () => {};
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("clears a saved filter before showing only the pinned sessions", () => {
    const events: string[] = [];
    const resetSubscription = globalResetFilter.subscribe((value) => value && events.push("reset"));
    globalFilterGroup.next({ pinnedFilter: false, integrationFilter: [{ name: "sso", value: true }] } as any);
    const filterSubscription = globalFilterGroup.subscribe((filters) => filters && events.push(filters.pinnedFilter ? "pinned" : "unpinned"));
    events.length = 0;
    document.body.insertAdjacentHTML("beforeend", '<div class="sessions filtered"></div>');

    component.showOnlyPinned();

    expect(events[0]).toBe("reset");
    expect(events[events.length - 1]).toBe("pinned");
    expect(globalFilterGroup.value.integrationFilter).toEqual([]);
    expect(component.showPinned).toBeTrue();
    expect(component.showAll).toBeFalse();

    resetSubscription.unsubscribe();
    filterSubscription.unsubscribe();
    document.querySelector(".sessions").remove();
  });

  describe("saved filter start/stop button", () => {
    const filters = (region: string): any => ({
      searchFilter: "",
      dateFilter: true,
      pinnedFilter: false,
      providerFilter: [],
      profileFilter: [],
      regionFilter: [{ show: true, name: region, value: true }],
      integrationFilter: [],
      typeFilter: [],
    });
    const session = (id: string, region: string, status: SessionStatus): any => ({
      sessionId: id,
      sessionName: `s-${id}`,
      region,
      status,
      type: "awsSsoRole",
    });
    let actions: jasmine.SpyObj<any>;

    beforeEach(() => {
      actions = jasmine.createSpyObj("SelectedSessionActionsService", { startSessions: Promise.resolve(), stopSessions: Promise.resolve() });
      (component as any).selectedSessionActionsService = actions;
      (component as any).optionsService = { pinned: [] };
      (component as any).behaviouralSubjectService.sessions = [
        session("1", "us-east-1", SessionStatus.active),
        session("2", "us-east-1", SessionStatus.inactive),
        session("3", "us-east-2", SessionStatus.active),
      ];
      component.segments = [
        { name: "EAST1", filterGroup: filters("us-east-1") },
        { name: "EAST2", filterGroup: filters("us-east-2") },
        { name: "EU", filterGroup: filters("eu-west-1") },
      ];
      component.selectedS = component.segments.map((segment) => ({ name: segment.name, selected: false }));
      component.updateSegmentActions();
      fixture.detectChanges();
    });

    it("offers start while a session of the filter is inactive, stop once all are active, nothing without sessions", () => {
      expect(component.segmentActions["EAST1"].kind).toBe("start");
      expect(component.segmentActions["EAST1"].tooltip).toBe("Start 1 session in EAST1");
      expect(component.segmentActions["EAST2"].kind).toBe("stop");
      expect(component.segmentActions["EAST2"].tooltip).toBe("Stop all 1 session in EAST2");
      expect(component.segmentActions["EU"]).toBeUndefined();

      const rows = fixture.nativeElement.querySelectorAll(".segment-row");
      expect(rows[0].querySelector(".segment-action.moon-Play-filled")).not.toBeNull();
      expect(rows[1].querySelector(".segment-action.moon-Stop")).not.toBeNull();
      expect(rows[2].querySelector(".segment-action")).toBeNull();
    });

    it("clicking the button starts the filter's sessions without applying the filter", async () => {
      const applied = spyOn(component, "applySegmentFilter");
      const button = fixture.nativeElement.querySelectorAll(".segment-row")[0].querySelector(".segment-action");

      button.click();
      await fixture.whenStable();

      expect(applied).not.toHaveBeenCalled();
      const [sessions, label] = actions.startSessions.calls.mostRecent().args;
      expect(sessions.map((s) => s.sessionId)).toEqual(["1", "2"]);
      expect(label).toBe("EAST1");
    });

    it("clicking stop stops the filter's sessions", async () => {
      fixture.nativeElement.querySelectorAll(".segment-row")[1].querySelector(".segment-action").click();
      await fixture.whenStable();

      expect(actions.stopSessions).toHaveBeenCalled();
      expect(actions.stopSessions.calls.mostRecent().args[0].map((s) => s.sessionId)).toEqual(["3"]);
    });
  });
});
