import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { AwsSsoOidcService, ssoOidcScopes } from "./aws-sso-oidc.service";
import { constants } from "../models/constants";

const mockCreateToken = jest.fn<any>();
const mockRegisterClient = jest.fn<any>();
const mockStartDeviceAuthorization = jest.fn<any>();

jest.mock("@aws-sdk/client-sso-oidc", () => ({
  ["SSOOIDC"]: class {
    createToken = mockCreateToken;
    registerClient = mockRegisterClient;
    startDeviceAuthorization = mockStartDeviceAuthorization;
  },
}));

const keychain = () => {
  const store = new Map<string, string>();
  return {
    store,
    getSecret: jest.fn(async (_service: string, account: string) => store.get(account) ?? null),
    saveSecret: jest.fn(async (_service: string, account: string, value: string) => {
      store.set(account, value);
    }),
    deleteSecret: jest.fn(async (_service: string, account: string) => {
      store.delete(account);
    }),
  };
};

const refreshKey = "aws-sso-integration-refresh-token-int-1";
const inFuture = () => Math.floor(Date.now() / 1000) + 90 * 24 * 3600;

describe("AwsSsoOidcService refresh tokens", () => {
  beforeEach(() => {
    mockCreateToken.mockReset();
    mockRegisterClient.mockReset();
    mockStartDeviceAuthorization.mockReset();
  });

  test("refreshAccessToken returns null without a stored refresh token", async () => {
    const service = new AwsSsoOidcService(null, null, false, keychain() as any);
    expect(await service.refreshAccessToken("int-1", "us-east-1")).toBeNull();
    expect(mockCreateToken).not.toHaveBeenCalled();
  });

  test("refreshAccessToken uses the refresh grant and keeps the rotated token", async () => {
    const kc = keychain();
    kc.store.set(refreshKey, JSON.stringify({ refreshToken: "old-refresh", clientId: "cid", clientSecret: "csecret" }));
    mockCreateToken.mockResolvedValue({ accessToken: "new-access", expiresIn: 3600, refreshToken: "new-refresh" });
    const service = new AwsSsoOidcService(null, null, false, kc as any);

    const before = Date.now();
    const result = await service.refreshAccessToken("int-1", "us-east-1");

    expect(mockCreateToken).toHaveBeenCalledWith({
      clientId: "cid",
      clientSecret: "csecret",
      grantType: "refresh_token",
      refreshToken: "old-refresh",
    });
    expect(result.accessToken).toBe("new-access");
    expect(result.expirationTime.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(JSON.parse(kc.store.get(refreshKey))).toEqual({ refreshToken: "new-refresh", clientId: "cid", clientSecret: "csecret" });
  });

  test("refreshAccessToken forgets a dead refresh token but keeps it on transient errors", async () => {
    const kc = keychain();
    const stored = JSON.stringify({ refreshToken: "r", clientId: "cid", clientSecret: "cs" });
    kc.store.set(refreshKey, stored);
    const service = new AwsSsoOidcService(null, null, false, kc as any);

    mockCreateToken.mockRejectedValueOnce(Object.assign(new Error("network"), { name: "TimeoutError" }));
    expect(await service.refreshAccessToken("int-1", "us-east-1")).toBeNull();
    expect(kc.store.get(refreshKey)).toBe(stored);

    mockCreateToken.mockRejectedValueOnce(Object.assign(new Error("expired"), { name: "InvalidGrantException" }));
    expect(await service.refreshAccessToken("int-1", "us-east-1")).toBeNull();
    expect(kc.store.has(refreshKey)).toBe(false);
  });

  test("login with an external browser uses the authorization code flow and stores the refresh token", async () => {
    const kc = keychain();
    const client = { clientId: "pkce-id", clientSecret: "pkce-secret", clientSecretExpiresAt: inFuture() };
    const windowService = {
      openVerificationWindow: jest.fn(),
      registerAuthorizationCodeClient: jest.fn(async () => client),
      signInWithAuthorizationCode: jest.fn(async () => ({ accessToken: "pkce-access", expiresIn: 28800, refreshToken: "pkce-refresh" })),
    };
    const repository = { getAwsSsoIntegration: () => ({ browserOpening: constants.inBrowser }) };
    const service = new AwsSsoOidcService(windowService as any, repository as any, false, kc as any);

    const result = await service.login("int-1", "us-east-1", "https://example.awsapps.com/start");

    expect(result.accessToken).toBe("pkce-access");
    expect(windowService.registerAuthorizationCodeClient).toHaveBeenCalledWith("us-east-1", "https://example.awsapps.com/start", ssoOidcScopes);
    expect(windowService.signInWithAuthorizationCode).toHaveBeenCalledWith("us-east-1", client, ssoOidcScopes);
    expect(windowService.openVerificationWindow).not.toHaveBeenCalled();
    expect(JSON.parse(kc.store.get(refreshKey))).toEqual({ refreshToken: "pkce-refresh", clientId: "pkce-id", clientSecret: "pkce-secret" });

    // The registered client is reused on the next sign-in
    await service.login("int-1", "us-east-1", "https://example.awsapps.com/start");
    expect(windowService.registerAuthorizationCodeClient).toHaveBeenCalledTimes(1);
  });

  test("login falls back to the device code flow when the authorization code client can't be registered", async () => {
    const kc = keychain();
    const windowService = {
      openVerificationWindow: jest.fn(async () => ({ clientId: "dev-id", clientSecret: "dev-secret", deviceCode: "dc" })),
      registerAuthorizationCodeClient: jest.fn(async () => {
        throw new Error("proxy");
      }),
      signInWithAuthorizationCode: jest.fn(),
    };
    const repository = { getAwsSsoIntegration: () => ({ browserOpening: constants.inBrowser }) };
    mockRegisterClient.mockResolvedValue({ clientId: "dev-id", clientSecret: "dev-secret", clientSecretExpiresAt: inFuture() });
    mockStartDeviceAuthorization.mockResolvedValue({ deviceCode: "dc", verificationUriComplete: "https://device?user_code=AB-CD" });
    mockCreateToken.mockResolvedValue({ accessToken: "dev-access", expiresIn: 28800, refreshToken: "dev-refresh" });
    const service = new AwsSsoOidcService(windowService as any, repository as any, false, kc as any);
    // The browser device flow polls createToken every 5 s; answer at once
    (service as any).waitForToken = async (request: any) => mockCreateToken(request);

    const result = await service.login("int-1", "us-east-1", "https://example.awsapps.com/start");

    expect(result.accessToken).toBe("dev-access");
    expect(windowService.signInWithAuthorizationCode).not.toHaveBeenCalled();
    expect(mockRegisterClient).toHaveBeenCalledWith({ clientName: "freeleapp", clientType: "public", scopes: ssoOidcScopes });
    expect(JSON.parse(kc.store.get(refreshKey))).toEqual({ refreshToken: "dev-refresh", clientId: "dev-id", clientSecret: "dev-secret" });
  });

  test("forgetRefreshToken deletes the stored token", async () => {
    const kc = keychain();
    kc.store.set(refreshKey, "{}");
    await new AwsSsoOidcService(null, null, false, kc as any).forgetRefreshToken("int-1");
    expect(kc.deleteSecret).toHaveBeenCalledWith(constants.appName, refreshKey);
  });
});
