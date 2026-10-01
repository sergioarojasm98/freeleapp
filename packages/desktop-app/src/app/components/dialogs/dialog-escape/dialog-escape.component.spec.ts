import { DialogEscapeComponent } from "./dialog-escape.component";

describe("DialogEscapeComponent", () => {
  let added: HTMLElement[];
  let listeners: DialogEscapeComponent[];

  const dialog = (): { component: DialogEscapeComponent; escaped: jasmine.Spy } => {
    const container = document.createElement("modal-container");
    const host = document.createElement("app-dialog-escape");
    container.appendChild(host);
    document.body.appendChild(container);
    added.push(container);
    const component = new DialogEscapeComponent({ nativeElement: host });
    const escaped = jasmine.createSpy("escape");
    component.escape.subscribe(escaped);
    component.ngOnInit();
    return { component, escaped };
  };

  const pressEscape = (): void => {
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    document.dispatchEvent(event);
    // The @HostListener, which a component built outside Angular doesn't get
    for (const listener of listeners) {
      listener.onEscape();
    }
  };

  beforeEach(() => {
    added = [];
    listeners = [];
  });

  afterEach(() => {
    listeners.forEach((listener) => listener.ngOnDestroy());
    added.forEach((element) => element.remove());
  });

  it("closes only the dialog on top", () => {
    const below = dialog();
    const top = dialog();
    listeners.push(below.component, top.component);

    pressEscape();

    expect(top.escaped).toHaveBeenCalledTimes(1);
    expect(below.escaped).not.toHaveBeenCalled();
  });

  it("leaves Escape to an open dropdown, then closes on the next one", () => {
    const only = dialog();
    listeners.push(only.component);
    const panel = document.createElement("ng-dropdown-panel");
    document.body.appendChild(panel);
    added.push(panel);

    pressEscape();
    expect(only.escaped).not.toHaveBeenCalled();

    panel.remove();
    pressEscape();
    expect(only.escaped).toHaveBeenCalledTimes(1);
  });
});
