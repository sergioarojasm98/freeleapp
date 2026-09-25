import { MainLayoutComponent } from "./main-layout.component";
import { compactMode, sidebarCollapsed, sidebarToggleRequests } from "../../components/command-bar/command-bar.component";

describe("MainLayoutComponent", () => {
  let component: MainLayoutComponent;
  let ipcSend: jasmine.Spy;

  const resizeTo = (width: number) => (component as any).windowWidth$.next(width);

  beforeEach(() => {
    sidebarCollapsed.next(false);
    compactMode.next(false);
    ipcSend = jasmine.createSpy("send");
    component = new MainLayoutComponent({ behaviouralSubjectService: { unselectSessions: () => {} } } as any, { ipcRenderer: { send: ipcSend } } as any);
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

  it("collapses the docked sidebar when the button is clicked on a wide window", () => {
    resizeTo(1200);
    sidebarToggleRequests.next();

    expect(sidebarCollapsed.value).toBeTrue();
    expect(component.sidebarOverlay).toBeFalse();
  });

  it("shows the sidebar as an overlay on a narrow window and hides it after 2s without hover", () => {
    jasmine.clock().install();
    try {
      resizeTo(760);
      sidebarToggleRequests.next();
      expect(component.sidebarOverlay).toBeTrue();
      expect(sidebarCollapsed.value).toBeFalse();

      jasmine.clock().tick(1999);
      expect(component.sidebarOverlay).toBeTrue();
      jasmine.clock().tick(1);
      expect(component.sidebarOverlay).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it("keeps the overlay open while hovered and closes it 2s after the pointer leaves", () => {
    jasmine.clock().install();
    try {
      resizeTo(760);
      sidebarToggleRequests.next();
      component.cancelSidebarOverlayClose();
      jasmine.clock().tick(5000);
      expect(component.sidebarOverlay).toBeTrue();

      component.scheduleSidebarOverlayClose();
      jasmine.clock().tick(2000);
      expect(component.sidebarOverlay).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it("forwards double-clicks on empty title bar areas only", () => {
    const bar = document.createElement("div");
    const button = document.createElement("button");
    bar.appendChild(button);

    component.onTitleBarDoubleClick({ target: button } as any);
    expect(ipcSend).not.toHaveBeenCalled();

    component.onTitleBarDoubleClick({ target: bar } as any);
    expect(ipcSend).toHaveBeenCalledWith("title-bar-double-click");
  });
});
