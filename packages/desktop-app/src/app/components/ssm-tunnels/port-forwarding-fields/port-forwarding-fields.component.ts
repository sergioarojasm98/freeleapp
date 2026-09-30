import { Component, Input } from "@angular/core";
import { TunnelDraft } from "../tunnel-draft";

@Component({
  selector: "app-port-forwarding-fields",
  templateUrl: "./port-forwarding-fields.component.html",
  styleUrls: ["./port-forwarding-fields.component.scss"],
})
export class PortForwardingFieldsComponent {
  @Input() draft: TunnelDraft;
  @Input() namePlaceholder = "e.g. rabbitmq-prod:15672";
  // Returns a local port that is free right now
  @Input() suggestLocalPort: () => Promise<number>;

  async useFreePort(): Promise<void> {
    this.draft.localPort = `${await this.suggestLocalPort()}`;
  }
}
