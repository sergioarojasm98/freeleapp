import { Session } from "@noovolari/leapp-core/models/session";
import { GlobalFilters } from "@noovolari/leapp-core/models/segment";
import { AwsSsoRoleSession } from "@noovolari/leapp-core/models/aws/aws-sso-role-session";
import { AzureSession } from "@noovolari/leapp-core/models/azure/azure-session";

export interface SessionFilterContext {
  // Named profile name for a profile id; may throw or return undefined for unknown ids
  profileName: (profileId: string) => string | undefined;
  // Ids of the pinned sessions
  pinned: string[];
}

const selected = <T extends { value: boolean }>(options: T[] | undefined): T[] => (options ?? []).filter((option) => option.value);

const matchesSearch = (session: Session, searchText: string, context: SessionFilterContext): boolean => {
  const text = searchText.toLowerCase();
  const anySession = session as any;
  const fields = [
    session.sessionName,
    session.type,
    session.region,
    anySession.email,
    anySession.roleArn,
    anySession.idpArn,
    anySession.roleSessionName,
  ];
  if (fields.some((field) => typeof field === "string" && field.toLowerCase().indexOf(text) > -1)) {
    return true;
  }
  try {
    return context.profileName(anySession.profileId)?.toLowerCase().indexOf(text) > -1;
  } catch (e) {
    return false;
  }
};

/**
 * The sessions a set of filters (the filter bar, or a saved filter) lets through, in their original order. This is
 * the one place that decides what a filter matches: the session list and the saved-filter start/stop button both use
 * it, so the button acts on exactly the sessions the list shows for that filter.
 */
export const filterSessions = (sessions: Session[], filters: GlobalFilters | null, context: SessionFilterContext): Session[] => {
  if (!filters) {
    return [...sessions];
  }
  const providers = selected(filters.providerFilter);
  const profiles = selected(filters.profileFilter);
  const regions = selected(filters.regionFilter);
  const types = selected(filters.typeFilter);
  const integrations = selected(filters.integrationFilter).map((filter) => filter.name);
  const searchText = filters.searchFilter ?? "";

  return sessions.filter((session) => {
    const profileId: string | undefined = (session as any).profileId;
    if (searchText !== "" && !matchesSearch(session, searchText, context)) {
      return false;
    }
    if (providers.length > 0 && !providers.some((provider) => session.type.indexOf(provider.id) > -1)) {
      return false;
    }
    if (profiles.length > 0 && !(profileId && profiles.some((profile) => profileId.indexOf(profile.id) > -1))) {
      return false;
    }
    if (regions.length > 0 && !regions.some((region) => session.region.indexOf(region.name) > -1)) {
      return false;
    }
    if (types.length > 0 && !types.some((type) => session.type.indexOf(type.id) > -1)) {
      return false;
    }
    if (filters.pinnedFilter && !context.pinned.includes(session.sessionId)) {
      return false;
    }
    if (filters.integrationFilter?.length > 0) {
      const integrationId = (session as AwsSsoRoleSession).awsSsoConfigurationId || (session as AzureSession).azureIntegrationId;
      if (!integrations.includes(integrationId)) {
        return false;
      }
    }
    return true;
  });
};
