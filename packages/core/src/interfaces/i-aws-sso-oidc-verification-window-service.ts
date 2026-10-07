import { RegisterClientResponse, StartDeviceAuthorizationResponse, VerificationResponse } from "../services/session/aws/aws-sso-role-service";

/** A client registered with AWS IAM Identity Center OIDC (`RegisterClient`). */
export interface OidcClient {
  clientId: string;
  clientSecret: string;
  /** Epoch seconds. */
  clientSecretExpiresAt: number;
}

/** Tokens returned by `CreateToken`. */
export interface OidcTokens {
  accessToken: string;
  /** Seconds. */
  expiresIn: number;
  refreshToken?: string;
}

export interface IAwsSsoOidcVerificationWindowService {
  openVerificationWindow(
    registerClientResponse: RegisterClientResponse,
    startDeviceAuthorizationResponse: StartDeviceAuthorizationResponse,
    windowModality: string,
    onWindowClose: () => void
  ): Promise<VerificationResponse>;

  /**
   * Optional: register an OIDC client for the authorization code grant with PKCE (the AWS SDK version in use doesn't
   * expose grantTypes/redirectUris). When missing, sign-in uses the device code flow.
   */
  registerAuthorizationCodeClient?(region: string, issuerUrl: string, scopes: string[]): Promise<OidcClient>;

  /**
   * Optional: sign in through the system browser with the authorization code grant and PKCE (a loopback redirect on
   * 127.0.0.1), then exchange the code for tokens. The user only confirms "Allow"; there is no code to compare.
   */
  signInWithAuthorizationCode?(region: string, client: OidcClient, scopes: string[]): Promise<OidcTokens>;
}
