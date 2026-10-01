import { BehaviorSubject } from "rxjs";

// What the main area shows, set from the sidebar: the session list, or the tunnels (all or only the pinned ones)
export type MainView = "sessions" | "tunnels" | "pinnedTunnels";
export const mainView = new BehaviorSubject<MainView>("sessions");

// The search box text while the main area shows tunnels
export const tunnelSearch = new BehaviorSubject<string>("");
