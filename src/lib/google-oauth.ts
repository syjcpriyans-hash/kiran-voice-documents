import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { unsealJson } from "@/lib/connection-crypto";

export const GOOGLE_AUTH_COOKIE = "kiran_google_auth";
export const GOOGLE_OAUTH_STATE_COOKIE = "kiran_google_oauth_state";

export type GoogleOAuthSession = {
  refreshToken: string;
  connectedAt: string;
};

type AccessTokenCache = {
  token: string;
  expiresAt: number;
};

const accessTokenCache = new Map<string, AccessTokenCache>();

function requiredEnvironment() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google self-service connection is not configured. Add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI in Vercel.",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

export function getPickerConfiguration() {
  const { clientId } = requiredEnvironment();
  const apiKey = process.env.GOOGLE_PICKER_API_KEY?.trim();
  const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER?.trim();

  if (!apiKey || !appId) {
    throw new Error(
      "Google Picker is not configured. Add GOOGLE_PICKER_API_KEY and GOOGLE_CLOUD_PROJECT_NUMBER in Vercel.",
    );
  }

  return { clientId, apiKey, appId };
}

export function buildGoogleAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = requiredEnvironment();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeAuthorizationCode(
  code: string,
): Promise<GoogleOAuthSession> {
  const { clientId, clientSecret, redirectUri } = requiredEnvironment();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    refresh_token?: string;
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.refresh_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        "Google did not return a persistent connection token. Reconnect and approve access again.",
    );
  }

  return {
    refreshToken: payload.refresh_token,
    connectedAt: new Date().toISOString(),
  };
}

function cacheKey(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex").slice(0, 24);
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<string> {
  const key = cacheKey(refreshToken);
  const cached = accessTokenCache.get(key);

  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const { clientId, clientSecret } = requiredEnvironment();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        "The Google connection has expired. Reconnect the Google Sheet.",
    );
  }

  accessTokenCache.set(key, {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in || 3600) * 1000,
  });

  return payload.access_token;
}

export async function getStoredOAuthSession(): Promise<GoogleOAuthSession | null> {
  const store = await cookies();
  return unsealJson<GoogleOAuthSession>(store.get(GOOGLE_AUTH_COOKIE)?.value);
}

export async function getConnectedGoogleAccessToken(): Promise<string> {
  const session = await getStoredOAuthSession();
  if (!session?.refreshToken) {
    throw new Error("Connect a Google account before choosing a spreadsheet.");
  }
  return refreshGoogleAccessToken(session.refreshToken);
}
