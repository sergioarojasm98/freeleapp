import { OptionsDialogComponent } from "./options-dialog.component";
import { constants } from "@noovolari/leapp-core/models/constants";
import { ConfirmationDialogComponent } from "../confirmation-dialog/confirmation-dialog.component";

describe("OptionsDialogComponent", () => {
  let options: any;
  let closeModal: jasmine.Spy;
  let modalService: any;
  let confirmation: any;

  const createDialog = async () => {
    const dialog = new OptionsDialogComponent(
      {
        logService: { log: () => {} },
        awsCoreService: { getRegions: () => [{ region: "us-east-1" }, { region: "eu-west-1" }] },
        azureCoreService: { getLocations: () => [] },
        repository: { getSessions: () => [] },
        pluginManagerService: { pluginContainers: [] },
      } as any,
      { closeModal, isDarkMode: () => false, validateAllFormFields: () => {} } as any,
      options,
      null,
      null,
      { toast: () => {} } as any,
      modalService,
      null,
      { nativeElement: document.createElement("div") } as any
    );
    await dialog.ngOnInit();
    return dialog;
  };
  const answer = (value: string) => confirmation.initialState.callback(value);

  beforeEach(() => {
    options = {
      colorTheme: constants.lightTheme,
      defaultRegion: "us-east-1",
      proxyConfiguration: { proxyProtocol: "https", proxyPort: "8080" },
      updateProxyConfiguration: () => {},
    };
    closeModal = jasmine.createSpy("closeModal");
    confirmation = undefined;
    modalService = {
      getModalsCount: () => 1,
      show: jasmine.createSpy("show").and.callFake((component, config) => {
        confirmation = { component, initialState: config.initialState, hide: jasmine.createSpy("hide"), onHidden: { subscribe: () => {} } };
        return confirmation;
      }),
    };
  });

  afterEach(() => document.body.classList.remove("dark-theme"));

  it("closes right away when nothing changed", async () => {
    const dialog = await createDialog();

    dialog.cancel();

    expect(modalService.show).not.toHaveBeenCalled();
    expect(closeModal).toHaveBeenCalled();
  });

  it("asks before discarding changes and closes on Discard", async () => {
    const dialog = await createDialog();
    dialog.selectedRegion = "eu-west-1";

    dialog.cancel();
    expect(confirmation.component).toBe(ConfirmationDialogComponent);
    expect(closeModal).not.toHaveBeenCalled();

    answer(constants.confirmed);
    dialog.ngOnDestroy();

    expect(closeModal).toHaveBeenCalled();
    expect(options.defaultRegion).toBe("us-east-1");
  });

  it("keeps editing when the confirmation is dismissed", async () => {
    const dialog = await createDialog();
    dialog.form.controls["sessionDuration"].setValue("4");

    dialog.cancel();
    answer(constants.confirmClosed);

    expect(closeModal).not.toHaveBeenCalled();
  });

  it("treats Esc like Cancel, and closes only the confirmation while it is open", async () => {
    const dialog = await createDialog();
    dialog.setColorTheme(constants.darkTheme);

    dialog.onEscape(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(modalService.show).toHaveBeenCalledTimes(1);

    dialog.onEscape(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(confirmation.hide).toHaveBeenCalled();
    expect(modalService.show).toHaveBeenCalledTimes(1);
  });

  it("puts the previous theme back when closed without Done", async () => {
    const dialog = await createDialog();
    dialog.setColorTheme(constants.darkTheme);

    dialog.cancel();
    answer(constants.confirmed);
    dialog.ngOnDestroy();

    expect(options.colorTheme).toBe(constants.lightTheme);
    expect(document.body.classList.contains("dark-theme")).toBeFalse();
  });

  it("saves without asking on Done and keeps the new theme", async () => {
    const dialog = await createDialog();
    dialog.setColorTheme(constants.darkTheme);
    dialog.selectedRegion = "eu-west-1";

    await dialog.saveOptions();
    dialog.ngOnDestroy();

    expect(modalService.show).not.toHaveBeenCalled();
    expect(options.colorTheme).toBe(constants.darkTheme);
    expect(options.defaultRegion).toBe("eu-west-1");
  });
});
