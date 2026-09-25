import { MainLayoutComponent } from "./main-layout.component";
import { compactMode, sidebarCollapsed } from "../../components/command-bar/command-bar.component";

describe("MainLayoutComponent", () => {
  let component: MainLayoutComponent;

  const resizeTo = (width: number) => (component as any).windowWidth$.next(width);

  beforeEach(() => {
    sidebarCollapsed.next(false);
    compactMode.next(false);
    component = new MainLayoutComponent({ behaviouralSubjectService: { unselectSessions: () => {} } } as any);
    component.ngOnInit();
  });

  afterEach(() => {
    component.ngOnDestroy();
    sidebarCollapsed.next(false);
    compactMode.next(false);
  });

  it("shows the sidebar and the full table on a wide window", () => {
    resizeTo(1200);

    expect(component.sidebarVisible).toBeTrue();
    expect(compactMode.value).toBeFalse();
  });

  it("hides the sidebar without changing the table layout when the user collapses it", () => {
    resizeTo(1200);
    sidebarCollapsed.next(true);

    expect(component.sidebarVisible).toBeFalse();
    expect(compactMode.value).toBeFalse();
  });

  it("auto-hides the sidebar on a narrow window and keeps the full table while it fits", () => {
    resizeTo(760);

    expect(component.sidebarVisible).toBeFalse();
    expect(compactMode.value).toBeFalse();
  });

  it("switches the table to the compact layout when the list gets too narrow", () => {
    resizeTo(600);

    expect(component.sidebarVisible).toBeFalse();
    expect(compactMode.value).toBeTrue();

    resizeTo(1200);
    expect(compactMode.value).toBeFalse();
  });
});
