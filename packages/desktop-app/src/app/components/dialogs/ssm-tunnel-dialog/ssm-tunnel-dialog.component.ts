import { Component, Input, OnInit } from "@angular/core";
import { SsmTunnel } from "@noovolari/leapp-core/models/ssm-tunnel";
import { validatePortForwarding } from "@noovolari/leapp-core/services/ssm-service";
import { AppService } from "../../../services/app.service";
import { AppProviderService } from "../../../services/app-provider.service";
import { defaultTunnelName, forwardingFrom, TunnelDraft, tunnelDraftFrom } from "../../ssm-tunnels/tunnel-draft";

@Component({
  selector: "app-ssm-tunnel-dialog",
  templateUrl: "./ssm-tunnel-dialog.component.html",
  styleUrls: ["./ssm-tunnel-dialog.component.scss"],
})
export class SsmTunnelDialogComponent implements OnInit {
  @Input() tunnel: SsmTunnel;
  @Input() onSaved: () => void;

  draft: TunnelDraft;
  error: string;

  constructor(private appService: AppService, private appProviderService: AppProviderService) {}

  get suggestLocalPort(): () => Promise<number> {
    return () => this.appProviderService.ssmTunnelService.suggestLocalPort();
  }

  ngOnInit(): void {
    this.draft = tunnelDraftFrom(this.tunnel);
  }

  closeModal(): void {
    this.appService.closeModal();
  }

  async save(): Promise<void> {
    const forwarding = forwardingFrom(this.draft);
    this.error = validatePortForwarding(forwarding);
    if (this.error) {
      return;
    }
    const tunnel: SsmTunnel = {
      ...this.tunnel,
      ...forwarding,
      name: this.draft.name.trim() || defaultTunnelName(this.tunnel.instanceName, forwarding),
      autoStart: this.draft.autoStart,
    };
    this.appProviderService.repository.updateSsmTunnel(tunnel);
    this.onSaved?.();
    this.closeModal();

    const tunnelService = this.appProviderService.ssmTunnelService;
    const changed =
      this.tunnel.remoteHost !== tunnel.remoteHost || this.tunnel.remotePort !== tunnel.remotePort || this.tunnel.localPort !== tunnel.localPort;
    if (changed && tunnelService.isRunning(tunnel.id)) {
      await tunnelService.restart(tunnel.id);
    }
  }
}
