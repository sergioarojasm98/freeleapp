import { describe, expect, test } from "@jest/globals";
import { customProfiles, isOwnProfile, ownProfileName, pickSsoRoleProfile, ssoRoleProfileName } from "./sso-role-profile";
import { SessionType } from "../models/session-type";

describe("sso-role-profile", () => {
  const roleArn = "arn:aws:iam::123456789012/AdministratorAccess";

  test("ssoRoleProfileName joins account and role, replacing characters a credentials section cannot hold", () => {
    expect(ssoRoleProfileName("payments-prod", roleArn)).toBe("payments-prod-AdministratorAccess");
    expect(ssoRoleProfileName("Payments  [prod] ", roleArn)).toBe("Payments-prod-AdministratorAccess");
  });

  test("pickSsoRoleProfile creates the account-role profile when it does not exist", () => {
    expect(pickSsoRoleProfile("payments-prod", roleArn, [{ id: "d", name: "default" }], [])).toEqual({
      name: "payments-prod-AdministratorAccess",
    });
  });

  test("pickSsoRoleProfile reuses an existing profile that no session uses", () => {
    const profiles = [{ id: "p", name: "payments-prod-AdministratorAccess" }];
    expect(pickSsoRoleProfile("payments-prod", roleArn, profiles, [{ profileId: "other" }])).toEqual({
      id: "p",
      name: "payments-prod-AdministratorAccess",
    });
  });

  test("pickSsoRoleProfile adds a suffix while the name is taken by another session", () => {
    const profiles = [
      { id: "p1", name: "payments-prod-AdministratorAccess" },
      { id: "p2", name: "payments-prod-AdministratorAccess-2" },
    ];
    const sessions = [{ profileId: "p1" }, { profileId: "p2" }];
    expect(pickSsoRoleProfile("payments-prod", roleArn, profiles, sessions)).toEqual({ name: "payments-prod-AdministratorAccess-3" });
  });

  test("ownProfileName is <account>-<role> for an IAM Identity Center role, else the session name", () => {
    expect(ownProfileName({ type: SessionType.awsSsoRole, sessionName: "payments prod", roleArn })).toBe("payments-prod-AdministratorAccess");
    expect(ownProfileName({ type: SessionType.awsIamUser, sessionName: " ci [bot] " })).toBe("ci-bot");
    expect(ownProfileName({ type: SessionType.awsIamUser, sessionName: "[ ]" })).toBe("session");
  });

  test("isOwnProfile accepts the session's own name and its -N variants only", () => {
    const session = { type: SessionType.awsSsoRole, sessionName: "payments-prod", roleArn };
    expect(isOwnProfile("payments-prod-AdministratorAccess", session)).toBe(true);
    expect(isOwnProfile("payments-prod-AdministratorAccess-3", session)).toBe(true);
    expect(isOwnProfile("payments-prod-AdministratorAccess-old", session)).toBe(false);
    expect(isOwnProfile("team-payments", session)).toBe(false);
  });

  test("customProfiles hides the profiles sessions have of their own", () => {
    const profiles = [
      { id: "1", name: "default" },
      { id: "2", name: "payments-prod-AdministratorAccess" },
      { id: "3", name: "team-payments" },
      // Nobody uses it: listed, so it can be deleted
      { id: "4", name: "billing-prod-ReadOnly" },
    ];
    const sessions = [
      { type: SessionType.awsSsoRole, sessionName: "payments-prod", roleArn, profileId: "2" },
      { type: SessionType.awsSsoRole, sessionName: "payments-prod", roleArn: "arn:aws:iam::1/ReadOnly", profileId: "3" },
      { type: SessionType.awsIamUser, sessionName: "default", profileId: "1" },
    ];
    expect(customProfiles(profiles, sessions).map((p) => p.id)).toEqual(["1", "3", "4"]);
  });
});
