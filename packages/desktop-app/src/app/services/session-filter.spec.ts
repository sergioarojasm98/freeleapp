import { filterSessions, SessionFilterContext } from "./session-filter";
import { GlobalFilters } from "@noovolari/leapp-core/models/segment";
import { Session } from "@noovolari/leapp-core/models/session";
import { SessionType } from "@noovolari/leapp-core/models/session-type";

const session = (fields: Partial<Session> & Record<string, any>): Session =>
  ({ status: 0, region: "us-east-1", type: SessionType.awsSsoRole, ...fields } as any);

const noFilters = (): GlobalFilters => ({
  searchFilter: "",
  dateFilter: true,
  pinnedFilter: false,
  providerFilter: [],
  profileFilter: [],
  regionFilter: [],
  integrationFilter: [],
  typeFilter: [],
});

describe("filterSessions", () => {
  const prod = session({ sessionId: "1", sessionName: "cogs-prod", profileId: "p-prod", awsSsoConfigurationId: "sso-a" });
  const qa = session({ sessionId: "2", sessionName: "rand-qa", profileId: "p-qa", region: "us-east-2", awsSsoConfigurationId: "sso-a" });
  const azure = session({ sessionId: "3", sessionName: "azure-sub", type: SessionType.azure, azureIntegrationId: "az-1" });
  const all = [prod, qa, azure];
  const context: SessionFilterContext = {
    profileName: (id) => ({ ["p-prod"]: "cogs-jo-prd", ["p-qa"]: "rand-jo-qa" }[id]),
    pinned: ["2"],
  };

  it("lets everything through without filters, keeping the order", () => {
    expect(filterSessions(all, null, context)).toEqual(all);
    expect(filterSessions(all, noFilters(), context)).toEqual(all);
  });

  it("searches names and named profile names, case-insensitively", () => {
    expect(filterSessions(all, { ...noFilters(), searchFilter: "PROD" }, context)).toEqual([prod]);
    expect(filterSessions(all, { ...noFilters(), searchFilter: "jo-qa" }, context)).toEqual([qa]);
  });

  it("survives a profile lookup that throws", () => {
    const throwing: SessionFilterContext = {
      profileName: () => {
        throw new Error("unknown profile");
      },
      pinned: [],
    };
    expect(filterSessions(all, { ...noFilters(), searchFilter: "azure" }, throwing)).toEqual([azure]);
  });

  it("applies only the selected options of each dimension", () => {
    const regions = [
      { show: true, name: "us-east-2", value: true },
      { show: true, name: "us-east-1", value: false },
    ];
    expect(filterSessions(all, { ...noFilters(), regionFilter: regions }, context)).toEqual([qa]);
    const unselected = regions.map((region) => ({ ...region, value: false }));
    expect(filterSessions(all, { ...noFilters(), regionFilter: unselected }, context)).toEqual(all);
  });

  it("filters by named profile, provider and type", () => {
    const profiles = [{ show: true, id: "p-prod", name: "cogs-jo-prd", value: true }];
    expect(filterSessions(all, { ...noFilters(), profileFilter: profiles }, context)).toEqual([prod]);
    const providers = [{ show: true, id: "azure", name: "Microsoft Azure", value: true }];
    expect(filterSessions(all, { ...noFilters(), providerFilter: providers }, context)).toEqual([azure]);
    const types = [{ show: true, id: SessionType.awsSsoRole, category: "Amazon AWS", name: "IAM Single Sign-On", value: true }];
    expect(filterSessions(all, { ...noFilters(), typeFilter: types }, context)).toEqual([prod, qa]);
  });

  it("keeps only pinned sessions when the pinned filter is on", () => {
    expect(filterSessions(all, { ...noFilters(), pinnedFilter: true }, context)).toEqual([qa]);
  });

  it("filters by integration, and a list with none selected matches nothing (as the session list does)", () => {
    expect(filterSessions(all, { ...noFilters(), integrationFilter: [{ name: "az-1", value: true }] }, context)).toEqual([azure]);
    expect(filterSessions(all, { ...noFilters(), integrationFilter: [{ name: "az-1", value: false }] }, context)).toEqual([]);
  });
});
