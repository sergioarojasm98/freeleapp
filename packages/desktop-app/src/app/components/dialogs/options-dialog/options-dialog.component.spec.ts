import { OptionsDialogComponent } from "./options-dialog.component";
import { constants } from "@noovolari/leapp-core/models/constants";

describe("OptionsDialogComponent", () => {
  let options: any;
  let closeModal: jasmine.Spy;

  const createDialog = () =>
    new OptionsDialogComponent(
      { logService: { log: () => {} } } as any,
      { closeModal, isDarkMode: () => false } as any,
      options,
      null,
      null,
      { toast: () => {} } as any,
      null,
      null
    );

  beforeEach(() => {
    options = { colorTheme: constants.lightTheme, updateProxyConfiguration: () => {} };
    closeModal = jasmine.createSpy("closeModal");
  });

  afterEach(() => document.body.classList.remove("dark-theme"));

  it("puts the previous theme back when closed without Done", () => {
    const dialog = createDialog();
    dialog.setColorTheme(constants.darkTheme);

    dialog.cancel();
    dialog.ngOnDestroy();

    expect(closeModal).toHaveBeenCalled();
    expect(options.colorTheme).toBe(constants.lightTheme);
    expect(document.body.classList.contains("dark-theme")).toBeFalse();
  });

  it("drops the fields that only Done saves", () => {
    const dialog = createDialog();
    dialog.selectedRegion = "eu-west-1";

    dialog.cancel();
    dialog.ngOnDestroy();

    expect(options.defaultRegion).toBeUndefined();
  });

  it("keeps the new theme and fields after Done", async () => {
    const dialog = createDialog();
    dialog.setColorTheme(constants.darkTheme);
    dialog.selectedRegion = "eu-west-1";

    await dialog.saveOptions();
    dialog.ngOnDestroy();

    expect(options.colorTheme).toBe(constants.darkTheme);
    expect(options.defaultRegion).toBe("eu-west-1");
  });
});
