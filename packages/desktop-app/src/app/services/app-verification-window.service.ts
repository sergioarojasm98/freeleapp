import { constants } from "@noovolari/leapp-core/models/constants";
import { Injectable } from "@angular/core";
import {
  RegisterClientResponse,
  StartDeviceAuthorizationResponse,
  VerificationResponse,
} from "@noovolari/leapp-core/services/session/aws/aws-sso-role-service";
import {
  IAwsSsoOidcVerificationWindowService,
  OidcClient,
  OidcTokens,
} from "@noovolari/leapp-core/interfaces/i-aws-sso-oidc-verification-window-service";
import { WindowService } from "./window.service";
import { MessageToasterService, ToastLevel } from "./message-toaster.service";
import { AppProviderService } from "./app-provider.service";

@Injectable({ providedIn: "root" })
export class AppVerificationWindowService implements IAwsSsoOidcVerificationWindowService {
  private static readonly redirectBase = "http://127.0.0.1/oauth/callback";
  private static readonly signInTimeoutMs = 5 * 60 * 1000;

  constructor(private windowService: WindowService, private toasterService: MessageToasterService, private appProviderService: AppProviderService) {}

  async openVerificationWindow(
    registerClientResponse: RegisterClientResponse,
    startDeviceAuthorizationResponse: StartDeviceAuthorizationResponse,
    windowModality: string,
    onWindowClose: () => void
  ): Promise<VerificationResponse> {
    if (startDeviceAuthorizationResponse.verificationUriComplete.indexOf("?user_code=") > -1) {
      const code = startDeviceAuthorizationResponse.verificationUriComplete.split("?user_code=")[1];
      this.windowService.authorizationDialog(code);
    }

    const openWindowInApp = constants.inApp.toString();

    if (startDeviceAuthorizationResponse.verificationUriComplete.indexOf("?user_code=") > -1) {
      const code = startDeviceAuthorizationResponse.verificationUriComplete.split("?user_code=")[1];
      this.toasterService.toast(`Your AWS user code for this SSO request is: ${code}`, ToastLevel.info, "SSO Security Code");
    }

    if (windowModality === openWindowInApp) {
      return this.openVerificationBrowserWindow(registerClientResponse, startDeviceAuthorizationResponse, onWindowClose);
    } else {
      return this.openExternalVerificationBrowserWindow(registerClientResponse, startDeviceAuthorizationResponse);
    }
  }

  /** Registers a public client for the authorization code grant (loopback redirect, any port per RFC 8252). */
  async registerAuthorizationCodeClient(region: string, issuerUrl: string, scopes: string[]): Promise<OidcClient> {
    const response = await this.oidcRequest(region, "/client/register", {
      clientName: "freeleapp",
      clientType: "public",
      scopes,
      grantTypes: ["authorization_code", "refresh_token"],
      redirectUris: [AppVerificationWindowService.redirectBase],
      issuerUrl,
    });
    return { clientId: response.clientId, clientSecret: response.clientSecret, clientSecretExpiresAt: response.clientSecretExpiresAt };
  }

  /**
   * Authorization code + PKCE through the system browser, like `aws sso login`: a one-shot HTTP server on 127.0.0.1
   * receives the code, which is exchanged for tokens. AWS shows only "Allow", never a code to compare.
   */
  async signInWithAuthorizationCode(region: string, client: OidcClient, scopes: string[]): Promise<OidcTokens> {
    const crypto = window.require("crypto");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");

    this.toasterService.toast("Continue the AWS sign-in in your browser.", ToastLevel.info, "AWS SSO");
    const { code, redirectUri } = await this.waitForAuthorizationCode(region, client.clientId, scopes, state, codeChallenge);

    const tokens = await this.oidcRequest(region, "/token", {
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      grantType: "authorization_code",
      code,
      redirectUri,
      codeVerifier,
    });
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, refreshToken: tokens.refreshToken };
  }

  private async openVerificationBrowserWindow(
    registerClientResponse: RegisterClientResponse,
    startDeviceAuthorizationResponse: StartDeviceAuthorizationResponse,
    onWindowClose: () => void
  ): Promise<VerificationResponse> {
    const parentWindowPosition = this.windowService.getCurrentWindow().getPosition();
    const verificationWindow = this.windowService.newWindow(
      startDeviceAuthorizationResponse.verificationUriComplete,
      true,
      "Portal url - Client verification",
      parentWindowPosition[0] + 200,
      parentWindowPosition[1] + 50
    );

    verificationWindow.loadURL(startDeviceAuthorizationResponse.verificationUriComplete);
    verificationWindow.on("close", (e) => {
      e.preventDefault();
      onWindowClose();
    });

    return new Promise((resolve, reject) => {
      // When the code is verified and the user has been logged in, the window can be closed
      verificationWindow.webContents.session.webRequest.onCompleted(
        {
          urls: this.getAssociateTokenUrls(),
        },
        (details, callback) => {
          if (details.method === "POST" && details.statusCode === 200) {
            verificationWindow.close();

            const verificationResponse: VerificationResponse = {
              clientId: registerClientResponse.clientId,
              clientSecret: registerClientResponse.clientSecret,
              deviceCode: startDeviceAuthorizationResponse.deviceCode,
            };
            resolve(verificationResponse);
          }

          callback({
            requestHeaders: details.requestHeaders,
            url: details.url,
          });
        }
      );

      verificationWindow.webContents.session.webRequest.onErrorOccurred((details) => {
        if (
          details.error.indexOf("net::ERR_ABORTED") < 0 &&
          details.error.indexOf("net::ERR_FAILED") < 0 &&
          details.error.indexOf("net::ERR_CACHE_MISS") < 0 &&
          details.error.indexOf("net::ERR_CONNECTION_REFUSED") < 0
        ) {
          if (verificationWindow) {
            verificationWindow.close();
          }
          reject(details.error.toString());
        }
      });
    });
  }

  private waitForAuthorizationCode(
    region: string,
    clientId: string,
    scopes: string[],
    state: string,
    codeChallenge: string
  ): Promise<{ code: string; redirectUri: string }> {
    const http = window.require("http");
    return new Promise((resolve, reject) => {
      let redirectUri = "";
      let done = false;
      let timer: any = null;
      let server: any = null;
      const finish = (err: Error, value?: { code: string; redirectUri: string }) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        server.close();
        if (err) {
          reject(err);
        } else {
          resolve(value);
        }
      };
      server = http.createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname !== "/oauth/callback") {
          response.writeHead(404);
          response.end();
          return;
        }
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const ok = !error && !!code && url.searchParams.get("state") === state;
        response.writeHead(200, { ["Content-Type"]: "text/html; charset=utf-8" });
        response.end(
          ok
            ? this.callbackPage("Freeleapp is signed in", "You can close this tab and go back to Freeleapp.")
            : this.callbackPage("Sign-in failed", `AWS answered: ${this.escapeHtml(error || "an unexpected response")}. Try again from Freeleapp.`)
        );
        finish(ok ? null : new Error(`AWS SSO sign-in failed: ${error || "invalid callback"}`), { code, redirectUri });
      });
      timer = setTimeout(() => finish(new Error("AWS SSO sign-in timed out. Please try again.")), AppVerificationWindowService.signInTimeoutMs);
      server.on("error", (err) => finish(err));
      server.listen(0, "127.0.0.1", () => {
        redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
        const params = new URLSearchParams({
          ["response_type"]: "code",
          ["client_id"]: clientId,
          ["redirect_uri"]: redirectUri,
          state,
          ["code_challenge_method"]: "S256",
          scopes: scopes.join(" "),
          ["code_challenge"]: codeChallenge,
        });
        this.windowService.openExternalUrl(`https://oidc.${region}.amazonaws.com/authorize?${params.toString()}`);
      });
    });
  }

  /** JSON POST to the IAM Identity Center OIDC API (unauthenticated endpoints), through Node so system CAs apply. */
  private oidcRequest(region: string, path: string, body: any): Promise<any> {
    const https = window.require("https");
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          host: `oidc.${region}.amazonaws.com`,
          path,
          method: "POST",
          timeout: 15000,
          headers: { ["Content-Type"]: "application/json", ["Content-Length"]: new TextEncoder().encode(payload).length },
        },
        (response) => {
          let data = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (data += chunk));
          response.on("end", () => {
            let json: any = {};
            try {
              json = data ? JSON.parse(data) : {};
            } catch (err) {
              json = {};
            }
            if (response.statusCode >= 200 && response.statusCode < 300) {
              resolve(json);
            } else {
              reject(
                new Error(`AWS SSO OIDC ${path} failed (${response.statusCode}): ${json.error_description || json.error || json.message || data}`)
              );
            }
          });
        }
      );
      request.on("timeout", () => request.destroy(new Error(`AWS SSO OIDC ${path} timed out`)));
      request.on("error", reject);
      request.write(payload);
      request.end();
    });
  }

  private callbackPage(title: string, message: string): string {
    return (
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
      `<body style="font-family:-apple-system,system-ui,sans-serif;text-align:center;padding-top:15vh">` +
      `<h2>${title}</h2><p>${message}</p></body></html>`
    );
  }

  private escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  private getAssociateTokenUrls() {
    return this.appProviderService.awsCoreService
      .getRegions()
      .map((region) => `https://oidc.${region.region}.amazonaws.com/device_authorization/associate_token`);
  }

  private async openExternalVerificationBrowserWindow(
    registerClientResponse: RegisterClientResponse,
    startDeviceAuthorizationResponse: StartDeviceAuthorizationResponse
  ): Promise<VerificationResponse> {
    const uriComplete = startDeviceAuthorizationResponse.verificationUriComplete;
    return new Promise((resolve) => {
      // Open external browser window and let authentication begins
      this.windowService.openExternalUrl(uriComplete);

      // Return the code to be used after
      const verificationResponse: VerificationResponse = {
        clientId: registerClientResponse.clientId,
        clientSecret: registerClientResponse.clientSecret,
        deviceCode: startDeviceAuthorizationResponse.deviceCode,
      };

      resolve(verificationResponse);
    });
  }
}
