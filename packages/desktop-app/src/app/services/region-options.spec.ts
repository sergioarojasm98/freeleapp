import { allRegionsGroup, recentRegionsGroup, withRecentRegions } from "./region-options";
import { SessionType } from "@noovolari/leapp-core/models/session-type";

describe("withRecentRegions", () => {
  const regions = ["us-east-1", "us-east-2", "us-west-2", "eu-central-1", "eu-west-1", "ap-south-1"].map((region) => ({ region }));
  const session = (region: string, type = SessionType.awsSsoRole) => ({ region, type } as any);

  it("puts the most used regions first, most frequent first, without repeating them", () => {
    const sessions = [
      session("us-west-2"),
      session("us-east-1"),
      session("us-east-1"),
      session("eu-central-1"),
      session("us-east-2"),
      session("ap-south-1"),
      session("us-east-1"),
      session("us-west-2"),
    ];

    const options = withRecentRegions(regions, sessions);

    expect(options.filter((o) => o.group === recentRegionsGroup).map((o) => o.region)).toEqual([
      "us-east-1",
      "us-west-2",
      "us-east-2",
      "eu-central-1",
    ]);
    expect(options.filter((o) => o.group === allRegionsGroup).map((o) => o.region)).toEqual(["eu-west-1", "ap-south-1"]);
  });

  it("ignores Azure sessions and unknown regions", () => {
    const options = withRecentRegions(regions, [session("eastus", SessionType.azure), session("mars-north-1"), session("eu-west-1")]);

    expect(options[0]).toEqual({ region: "eu-west-1", group: recentRegionsGroup });
    expect(options.length).toBe(regions.length);
  });

  it("lists every region under All Regions when there are no sessions", () => {
    const options = withRecentRegions(regions, []);

    expect(options.every((o) => o.group === allRegionsGroup)).toBeTrue();
    expect(options.map((o) => o.region)).toEqual(regions.map((r) => r.region));
  });
});
