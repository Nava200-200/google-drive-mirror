import { requestUrl } from "obsidian";
import { OAUTH_SCOPE, PluginSettings } from "./types";
import { log } from "./logger";
import { t } from "./i18n";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Manages the OAuth 2.0 flow against Google for a Cloud app created by the
 * user themselves ("Desktop app" client, with secret).
 *
 * - Interactive sign-in (DESKTOP ONLY): `openLogin()` runs the loopback flow
 *   with PKCE. A local HTTP server on 127.0.0.1 catches the redirect. The
 *   Node-only server lives in `oauth-loopback.ts` and is imported LAZILY, so a
 *   mobile bundle never touches `http`/`net`.
 * - MOBILE has no way to receive an OAuth redirect (Google removed the OOB
 *   copy-paste flow, rejects custom `obsidian://` schemes for every client
 *   type, and there is no loopback server on a phone). So mobile does NOT sign
 *   in interactively. Instead the user signs in on desktop, copies the
 *   resulting refresh token (`exportRefreshToken()`), and pastes it on mobile
 *   (`importRefreshToken()`). The token is account-level and works on any
 *   device with the same client id/secret.
 *
 * `getAccessToken()` exchanges the stored refresh token for a short-lived
 * access token (with in-memory cache) — this works on every platform.
 */
export class OAuthManager {
  private settings: PluginSettings;
  private cachedAccessToken: string | null = null;
  private cachedTokenExpiryMs = 0;

  constructor(settings: PluginSettings) {
    this.settings = settings;
  }

  /**
   * Re-points this manager at a new settings object and drops the cached access
   * token. Used after config sync replaces `data.json` (and thus the settings
   * object + possibly the credentials) on this device.
   */
  setSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.cachedAccessToken = null;
    this.cachedTokenExpiryMs = 0;
  }

  /** Is enough configured to fetch tokens? */
  isConfigured(): boolean {
    return Boolean(this.settings.clientId && this.settings.refreshToken);
  }

  /**
   * Interactive sign-in (desktop loopback + PKCE). Opens the system browser and
   * waits for the redirect, then exchanges the code for tokens. Stores the
   * refresh token in the settings (the caller must subsequently call
   * saveSettings()).
   */
  async openLogin(openBrowser: (url: string) => void): Promise<void> {
    const clientId = this.settings.clientId;
    if (!clientId || !this.settings.clientSecret) {
      throw new Error(t("oauthCredentialsMissing"));
    }

    const state = randomToken();
    const codeVerifier = randomVerifier();
    const codeChallenge = await pkceChallenge(codeVerifier);

    log.info("Login started, waiting for redirect…");
    const { awaitLoopbackAuthCode } = await import("./oauth-loopback");
    const { code, redirectUri } = await awaitLoopbackAuthCode(
      state,
      (redirect) =>
        buildAuthUrl(clientId, redirect, state, codeChallenge),
      openBrowser
    );

    log.info("Auth code received, exchanging for token (redirect_uri=" + redirectUri + ")");
    const tokenResp = await this.exchangeCodeForTokens(
      code,
      redirectUri,
      clientId,
      codeVerifier
    );
    log.info("Token response received. refresh_token present:", Boolean(tokenResp.refresh_token));

    if (!tokenResp.refresh_token) {
      throw new Error(t("oauthNoRefreshToken"));
    }

    this.settings.refreshToken = tokenResp.refresh_token;
    this.cachedAccessToken = tokenResp.access_token;
    this.cachedTokenExpiryMs = Date.now() + (tokenResp.expires_in - 60) * 1000;
  }

  // ---------- Token export / import (desktop → mobile) ----------

  /** The current refresh token, for copying to another device. Empty if none. */
  exportRefreshToken(): string {
    return this.settings.refreshToken;
  }

  /**
   * Imports a refresh token pasted from another (signed-in) device and verifies
   * it by fetching an access token. Requires client id + secret to be set.
   * Caller must saveSettings() afterwards. Throws on an invalid token.
   */
  async importRefreshToken(token: string): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error(t("oauthImportEmpty"));
    }
    if (!this.settings.clientId || !this.settings.clientSecret) {
      throw new Error(t("oauthCredentialsMissing"));
    }
    // Stage into settings so refreshAccessToken() can use it, but roll back if
    // the token turns out to be invalid.
    const previous = this.settings.refreshToken;
    this.settings.refreshToken = trimmed;
    this.cachedAccessToken = null;
    this.cachedTokenExpiryMs = 0;
    try {
      await this.refreshAccessToken();
    } catch (e) {
      this.settings.refreshToken = previous;
      this.cachedAccessToken = null;
      this.cachedTokenExpiryMs = 0;
      throw e;
    }
  }

  /**
   * Returns a valid access token; renews it via the refresh token when
   * needed. Throws if not configured.
   */
  async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error(t("oauthNotSignedIn"));
    }
    // Cache with a 60s safety margin.
    if (this.cachedAccessToken && Date.now() < this.cachedTokenExpiryMs) {
      return this.cachedAccessToken;
    }
    return this.refreshAccessToken();
  }

  /** Forces a token renewal. */
  private async refreshAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret,
      refresh_token: this.settings.refreshToken,
      grant_type: "refresh_token",
    });

    const resp = await requestUrl({
      url: GOOGLE_TOKEN_ENDPOINT,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: body.toString(),
      throw: false,
    });

    if (resp.status !== 200) {
      throw new Error(
        t("oauthTokenRefreshFailed", { status: resp.status, text: resp.text })
      );
    }

    const json = resp.json as TokenResponse;
    this.cachedAccessToken = json.access_token;
    this.cachedTokenExpiryMs = Date.now() + (json.expires_in - 60) * 1000;
    return this.cachedAccessToken;
  }

  /** Clears tokens (logout). */
  reset(): void {
    this.settings.refreshToken = "";
    this.cachedAccessToken = null;
    this.cachedTokenExpiryMs = 0;
  }

  private async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    clientId: string,
    codeVerifier: string
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: this.settings.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    });

    const resp = await requestUrl({
      url: GOOGLE_TOKEN_ENDPOINT,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: body.toString(),
      throw: false,
    });

    if (resp.status !== 200) {
      log.error("Code exchange failed:", resp.status, resp.text);
      throw new Error(
        t("oauthCodeExchangeFailed", { status: resp.status, text: resp.text })
      );
    }
    return resp.json as TokenResponse;
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Builds the Google consent URL for a given redirect_uri (with PKCE). */
function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string
): string {
  return (
    GOOGLE_AUTH_ENDPOINT +
    "?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: OAUTH_SCOPE,
      access_type: "offline",
      prompt: "consent", // forces a refresh token even on repeated login
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    }).toString()
  );
}

function randomToken(): string {
  // No crypto need here beyond the CSRF state; simple, sufficient entropy.
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += Math.floor((1 + Math.random()) * 0x100000000)
      .toString(16)
      .slice(1);
  }
  return s;
}

/**
 * A high-entropy PKCE code_verifier (RFC 7636): 43–128 chars from the
 * unreserved set. We build 64 chars from the allowed alphabet.
 */
function randomVerifier(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let s = "";
  for (let i = 0; i < 64; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

/**
 * PKCE S256 challenge: BASE64URL(SHA-256(verifier)). Uses WebCrypto
 * (`crypto.subtle`), available on both desktop and Obsidian mobile.
 */
export async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64Url(new Uint8Array(digest));
}

/** BASE64URL without padding. */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
