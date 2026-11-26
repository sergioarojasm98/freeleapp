import { SelectedSessionActionsService } from "./selected-session-actions.service";
import { ToastLevel } from "./message-toaster.service";
import { SessionStatus } from "@noovolari/leapp-core/models/session-status";
import { Session } from "@noovolari/leapp-core/models/session";

// A session service that starts and stops sessions after a short delay, records the order of the calls, and how many
// ran at the same time. Ids in `failing` fail to start the way the core does: status back to inactive and an error.
class FakeSessionService {
  calls: string[] = [];
  maxInFlight = 0;
  private inFlight = 0;

  constructor(private sessions: Session[], private failing: Set<string>) {}

  start(id: string): Promise<void> {
    return this.run(`start ${id}`, () => {
      if (this.failing.has(id)) {
        this.find(id).status = SessionStatus.inactive;
        throw new Error(`cannot start ${id}`);
      }
      this.find(id).status = SessionStatus.active;
    });
  }

  stop(id: string): Promise<void> {
    return this.run(`stop ${id}`, () => {
      this.find(id).status = SessionStatus.inactive;
    });
  }

  private find(id: string): Session {
    return this.sessions.find((s) => s.sessionId === id);
  }

  private async run(call: string, effect: () => void): Promise<void> {
    this.calls.push(call);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.inFlight--;
    effect();
  }
}

const session = (id: string, status: SessionStatus, extra: Record<string, any> = {}): Session =>
  ({ sessionId: id, sessionName: `name-${id}`, status, region: "us-east-1", type: "awsSsoRole", ...extra } as any);

describe("SelectedSessionActionsService batch start/stop", () => {
  let sessions: Session[];
  let fake: FakeSessionService;
  let toasts: { message: string; level: ToastLevel; title: string }[];
  let service: SelectedSessionActionsService;

  const build = (list: Session[], failing: string[] = []) => {
    sessions = list;
    fake = new FakeSessionService(sessions, new Set(failing));
    toasts = [];
    const appProviderService: any = {
      sessionFactory: { getSessionService: () => fake },
      logService: { log: () => {} },
      behaviouralSubjectService: {
        unselectSessions: () => {},
        getSessionById: (id: string) => sessions.find((s) => s.sessionId === id),
      },
    };
    const toaster: any = { toast: (message: string, level: ToastLevel, title: string) => toasts.push({ message, level, title }) };
    service = new SelectedSessionActionsService(appProviderService, null, null, null, null, toaster);
  };

  it("starts the inactive sessions one after another and skips the active ones", async () => {
    build([session("a", SessionStatus.inactive), session("b", SessionStatus.active), session("c", SessionStatus.inactive)]);

    const result = await service.startSessions(sessions, "PROD");

    expect(fake.calls).toEqual(["start a", "start c"]);
    expect(fake.maxInFlight).toBe(1);
    expect(result.done.map((s) => s.sessionId)).toEqual(["a", "c"]);
    expect(sessions.every((s) => s.status === SessionStatus.active)).toBeTrue();
    expect(toasts).toEqual([{ message: "2 sessions started.", level: ToastLevel.success, title: "PROD" }]);
  });

  it("keeps going after a failure and names the failed session", async () => {
    build([session("a", SessionStatus.inactive), session("b", SessionStatus.inactive), session("c", SessionStatus.inactive)], ["b"]);

    const result = await service.startSessions(sessions, "PROD");

    expect(fake.calls).toEqual(["start a", "start b", "start c"]);
    expect(result.failed.map((s) => s.sessionId)).toEqual(["b"]);
    expect(toasts[0].level).toBe(ToastLevel.warn);
    expect(toasts[0].message).toBe("2 of 3 sessions started. Failed: name-b.");
  });

  it("leaves a session alone when an earlier one in the batch uses the same named profile", async () => {
    build([
      session("a", SessionStatus.inactive, { profileId: "p1" }),
      session("b", SessionStatus.inactive, { profileId: "p1" }),
      session("c", SessionStatus.inactive, { profileId: "p2" }),
    ]);

    const result = await service.startSessions(sessions, "QA");

    expect(fake.calls).toEqual(["start a", "start c"]);
    expect(result.sameProfile.map((s) => s.sessionId)).toEqual(["b"]);
    expect(toasts[0].message).toContain("name-b");
    expect(toasts[0].level).toBe(ToastLevel.warn);
  });

  it("after an SSO session fails, skips the rest of that integration instead of signing in again", async () => {
    build(
      [
        session("a", SessionStatus.inactive, { awsSsoConfigurationId: "sso-1" }),
        session("b", SessionStatus.inactive, { awsSsoConfigurationId: "sso-1" }),
        session("c", SessionStatus.inactive, { awsSsoConfigurationId: "sso-2" }),
      ],
      ["a"]
    );

    const result = await service.startSessions(sessions, "PROD");

    expect(fake.calls).toEqual(["start a", "start c"]);
    expect(result.failed.map((s) => s.sessionId)).toEqual(["a", "b"]);
    expect(result.done.map((s) => s.sessionId)).toEqual(["c"]);
  });

  it("stops the active and pending sessions one after another", async () => {
    build([session("a", SessionStatus.active), session("b", SessionStatus.inactive), session("c", SessionStatus.pending)]);

    const result = await service.stopSessions(sessions, "DEV");

    expect(fake.calls).toEqual(["stop a", "stop c"]);
    expect(fake.maxInFlight).toBe(1);
    expect(result.done.length).toBe(2);
    expect(sessions.every((s) => s.status === SessionStatus.inactive)).toBeTrue();
    expect(toasts).toEqual([{ message: "2 sessions stopped.", level: ToastLevel.success, title: "DEV" }]);
  });

  it("does nothing and shows nothing when there is nothing to do", async () => {
    build([session("a", SessionStatus.active)]);

    await service.startSessions(sessions, "PROD");

    expect(fake.calls).toEqual([]);
    expect(toasts).toEqual([]);
  });
});
