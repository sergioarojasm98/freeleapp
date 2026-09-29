// Named profiles for AWS IAM Identity Center roles. Each role gets its own "<account>-<role>" profile, so any number of
// roles can be active at once, and the user can still rename it or pick another profile.

interface ProfileLike {
  id: string;
  name: string;
}

interface SessionLike {
  profileId?: string;
}

/**
 * The profile name for a role: "<account name>-<role name>", with whitespace and brackets (not valid in the
 * section names of ~/.aws/credentials) replaced by "-"
 */
export const ssoRoleProfileName = (accountName: string, roleArn: string): string => {
  const roleName = roleArn.split("/").slice(1).join("/");
  return `${accountName}-${roleName}`
    .trim()
    .replace(/[\s[\]]+/g, "-")
    .replace(/-{2,}/g, "-");
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
): { id?: string; name: string } => {
  const baseName = ssoRoleProfileName(accountName, roleArn);
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
