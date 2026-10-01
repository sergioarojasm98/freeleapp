import Segment from "../models/segment";
import { LeappNotification } from "../models/notification";
import { RemoteWorkspacesSettingsMap } from "../models/remote-workspace-settings-map";

export interface GlobalSettings {
  defaultRegion: string;
  defaultLocation: string;
  macOsTerminal: string;
  pinned: string[];
  segments: Segment[];
  colorTheme: string;
  credentialMethod: string;
  samlRoleSessionDuration: number;
  ssmRegionBehaviour: string;
  notifications: LeappNotification[];
  requirePassword: number;
  touchIdEnabled: boolean;
  remoteWorkspacesSettingsMap: RemoteWorkspacesSettingsMap;
}
