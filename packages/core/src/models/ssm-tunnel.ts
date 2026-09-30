// A saved SSM port forwarding: a local port that reaches a port on an instance, or on a host the instance can reach
export interface SsmTunnel {
  id: string;
  name: string;
  // The AWS session whose credentials start the tunnel
  sessionId: string;
  instanceId: string;
  instanceName: string;
  region: string;
  // The instance itself when empty
  remoteHost?: string;
  remotePort: number;
  localPort: number;
  // Start the tunnel whenever its session starts
  autoStart: boolean;
}

export enum SsmTunnelStatus {
  stopped = "stopped",
  starting = "starting",
  active = "active",
  reconnecting = "reconnecting",
  failed = "failed",
}

export interface SsmTunnelState {
  status: SsmTunnelStatus;
  // Why the tunnel failed or is reconnecting
  message?: string;
  // When the tunnel last became active (ISO date)
  activeSince?: string;
}
