import { describe, expect, test } from "@jest/globals";
import { pickSsoRoleProfile, ssoRoleProfileName } from "./sso-role-profile";

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
});
