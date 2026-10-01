import { emptyTunnelDraft } from "../tunnel-draft";
import { PortForwardingFieldsComponent } from "./port-forwarding-fields.component";

describe("PortForwardingFieldsComponent", () => {
  it("fills the remote port from a common port and marks it as chosen", () => {
    const fields = new PortForwardingFieldsComponent();
    fields.draft = emptyTunnelDraft();

    fields.useCommonPort(5432);

    expect(fields.draft.remotePort).toBe("5432");
    expect(fields.isCommonPortSelected(5432)).toBe(true);
    expect(fields.isCommonPortSelected(3306)).toBe(false);
  });
});
