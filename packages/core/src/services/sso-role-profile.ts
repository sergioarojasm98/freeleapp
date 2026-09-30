// Named profiles of their own for sessions. Each AWS IAM Identity Center role gets a "<account>-<role>" profile, so any
// number of roles can be active at once, and the user can still rename it or pick another profile. A session whose
// profile is deleted moves to a profile of its own the same way.

import { SessionType } from "../models/session-type";
import { constants } from "../models/constants";

interface ProfileLike {
  id: string;
  name: string;
}

interface SessionLike {
  profileId?: string;
}

// Whitespace and brackets are not valid in the section names of ~/.aws/credentials
const profileSafeName = (name: string): string =>
  name
    .trim()
    .replace(/[\s[\]]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "") || "session";

/**
 * The profile name for a role: "<account name>-<role name>", with whitespace and brackets (not valid in the
 * section names of ~/.aws/credentials) replaced by "-"
 */
export const ssoRoleProfileName = (accountName: string, roleArn: string): string => {
  const roleName = roleArn.split("/").slice(1).join("/");
  return profileSafeName(`${accountName}-${roleName}`);
};

/**
 * The profile name a session would have on its own: "<account>-<role>" for an IAM Identity Center role, else its name
 */
export const ownProfileName = (session: { type: SessionType; sessionName: string; roleArn?: string }): string =>
  session.type === SessionType.awsSsoRole ? ssoRoleProfileName(session.sessionName, session.roleArn) : profileSafeName(session.sessionName);

/**
 * The profile called baseName if no session uses it, otherwise the first free "baseName-N". The id is set when a
 * profile with that name already exists and is free.
 */
export const pickFreeProfile = (baseName: string, profiles: ProfileLike[], sessions: readonly unknown[]): { id?: string; name: string } => {
  for (let suffix = 1; ; suffix++) {
    const name = suffix === 1 ? baseName : `${baseName}-${suffix}`;
    const profile = profiles.find((p) => p.name === name);
    if (!profile) {
      return { name };
    }
    if (!sessions.some((session) => (session as SessionLike).profileId === profile.id)) {
      return { id: profile.id, name };
    }
  }
};

/**
 * The profile a role session should use: the "<account>-<role>" profile if no other session uses it, otherwise the
 * first free "<account>-<role>-N". The id is set when a profile with that name already exists and is free.
 */
export const pickSsoRoleProfile = (
  accountName: string,
  roleArn: string,
  profiles: ProfileLike[],
  // Any session: only AWS sessions have a profileId
  sessions: readonly unknown[]
): { id?: string; name: string } => pickFreeProfile(ssoRoleProfileName(accountName, roleArn), profiles, sessions);

/**
 * Whether a profile is the session's own one: the name ownProfileName gives it, or that name with a "-N" suffix
 */
export const isOwnProfile = (profileName: string, session: { type: SessionType; sessionName: string; roleArn?: string }): boolean => {
  const baseName = ownProfileName(session);
  return profileName === baseName || (profileName.startsWith(`${baseName}-`) && /^\d+$/.test(profileName.slice(baseName.length + 1)));
};

/**
 * The profiles a user manages in Settings: "default" and the ones that are not a session's own profile. A session's
 * own profile comes and goes with the session.
 */
export const customProfiles = <P extends ProfileLike>(profiles: P[], sessions: readonly unknown[]): P[] =>
  profiles.filter(
    (profile) =>
      profile.name === constants.defaultAwsProfileName ||
      !sessions.some((session) => (session as SessionLike).profileId === profile.id && isOwnProfile(profile.name, session as any))
  );
