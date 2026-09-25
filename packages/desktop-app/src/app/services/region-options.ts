import { Session } from "@noovolari/leapp-core/models/session";
import { SessionType } from "@noovolari/leapp-core/models/session-type";

export const recentRegionsGroup = "Recently used";
export const allRegionsGroup = "All regions";
export const recentRegionsLimit = 4;

export interface RegionOption {
  region: string;
  group: string;
}

/**
 * Put the AWS regions used by the most sessions on top of a region dropdown (ng-select groupBy="group").
 * Ties keep the order of the full region list; recent regions are not repeated in the full list.
 */
export const withRecentRegions = (regions: { region: string }[], sessions: Session[], limit = recentRegionsLimit): RegionOption[] => {
  const known = new Set(regions.map((r) => r.region));
  const counts = new Map<string, number>();
  sessions
    .filter((session) => session.type !== SessionType.azure && known.has(session.region))
    .forEach((session) => counts.set(session.region, (counts.get(session.region) ?? 0) + 1));

  const order = regions.map((r) => r.region);
  const recent = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || order.indexOf(a) - order.indexOf(b)).slice(0, limit);

  return [
    ...recent.map((region) => ({ region, group: recentRegionsGroup })),
    ...order.filter((region) => !recent.includes(region)).map((region) => ({ region, group: allRegionsGroup })),
  ];
};
