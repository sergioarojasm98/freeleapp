import { SsmPortForwarding } from "@noovolari/leapp-core/services/ssm-service";
import { SsmTunnel } from "@noovolari/leapp-core/models/ssm-tunnel";

// What the port forwarding form edits, as typed
export interface TunnelDraft {
  name: string;
  remoteHost: string;
  remotePort: string;
  localPort: string;
  autoStart: boolean;
}

export const emptyTunnelDraft = (): TunnelDraft => ({ name: "", remoteHost: "", remotePort: "", localPort: "", autoStart: false });

export const tunnelDraftFrom = (tunnel: SsmTunnel): TunnelDraft => ({
  name: tunnel.name,
  remoteHost: tunnel.remoteHost ?? "",
  remotePort: `${tunnel.remotePort}`,
  localPort: `${tunnel.localPort}`,
  autoStart: tunnel.autoStart,
});

export const forwardingFrom = (draft: TunnelDraft): SsmPortForwarding => {
  const remotePort = Number(draft.remotePort);
  return {
    remoteHost: draft.remoteHost.trim() || undefined,
    remotePort,
    // An empty local port uses the same number as the remote one
    localPort: draft.localPort.trim() ? Number(draft.localPort) : remotePort,
  };
};

// "rabbitmq-prod-1:15672", or the first label of the remote host: "batchengine-psql:5432"
export const defaultTunnelName = (instanceName: string, forwarding: SsmPortForwarding): string =>
  `${forwarding.remoteHost ? forwarding.remoteHost.split(".")[0] : instanceName}:${forwarding.remotePort}`;
