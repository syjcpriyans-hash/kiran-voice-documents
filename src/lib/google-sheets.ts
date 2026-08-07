import { createHash, createSign } from "node:crypto";
import { getActiveSheetConnection } from "@/lib/sheet-connection";
import {
  getStoredOAuthSession,
  refreshGoogleAccessToken,
} from "@/lib/google-oauth";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4";

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

const legacyTokenCache = new Map<string, TokenCache>();

export type GoogleSheetProperties = {
  sheetId: number;
  title: string;
  hidden?: boolean;
  gridProperties?: {
    rowCount?: number;
    columnCount?: number;
  };
};

export type GoogleSpreadsheetMetadata = {
  spreadsheetId: string;
  properties?: {
    title?: string;
  };
  sheets?: Array<{
    properties: GoogleSheetProperties;
  }>;
};

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function getLegacyGoogleConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID?.trim();
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();

  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error(
      "No Google Sheet is connected. Use Connect Google Sheet, or configure the legacy service-account variables.",
    );
  }

  return { spreadsheetId, clientEmail, privateKey };
}

async function getLegacyAccessToken(): Promise<string> {
  const { clientEmail, privateKey } = getLegacyGoogleConfig();
  const cacheKey = createHash("sha256")
    .update(`${clientEmail}:${privateKey.slice(0, 40)}`)
    .digest("hex")
    .slice(0, 24);
  const now = Math.floor(Date.now() / 1000);
  const cached = legacyTokenCache.get(cacheKey);

  if (cached && cached.expiresAt > now + 60) {
    return cached.accessToken;
  }

  const encodedHeader = base64Url(
    JSON.stringify({
      alg: "RS256",
      typ: "JWT",
    }),
  );
  const encodedPayload = base64Url(
    JSON.stringify({
      iss: clientEmail,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(privateKey);
  const assertion = `${signingInput}.${base64Url(signature)}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Google authentication failed (${response.status}). ${detail.slice(0, 400)}`,
    );
  }

  const token = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!token.access_token) {
    throw new Error("Google authentication returned no access token.");
  }

  legacyTokenCache.set(cacheKey, {
    accessToken: token.access_token,
    expiresAt: now + (token.expires_in || 3600),
  });

  return token.access_token;
}

async function activeContext(): Promise<{
  spreadsheetId: string;
  accessToken: string;
}> {
  const connection = await getActiveSheetConnection();

  if (connection.mode === "oauth") {
    const session = await getStoredOAuthSession();
    if (!session?.refreshToken) {
      throw new Error(
        "The connected Google account is missing. Reconnect the Google Sheet.",
      );
    }

    return {
      spreadsheetId: connection.config.spreadsheetId,
      accessToken: await refreshGoogleAccessToken(session.refreshToken),
    };
  }

  const legacy = getLegacyGoogleConfig();
  return {
    spreadsheetId: legacy.spreadsheetId,
    accessToken: await getLegacyAccessToken(),
  };
}

async function googleRequest<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);
  let lastError = "Google Sheets request failed.";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);

    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
    });

    if (response.ok) {
      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    const detail = await response.text();
    lastError = `Google Sheets returned ${response.status}: ${detail.slice(0, 700)}`;

    if (!retryableStatuses.has(response.status) || attempt === 3) {
      throw new Error(lastError);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 500 * 2 ** attempt + Math.floor(Math.random() * 250)),
    );
  }

  throw new Error(lastError);
}

export function getSpreadsheetId(): string {
  return getLegacyGoogleConfig().spreadsheetId;
}

export async function getActiveSpreadsheetId(): Promise<string> {
  return (await getActiveSheetConnection()).config.spreadsheetId;
}

export function quoteSheetName(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

export async function getSpreadsheetMetadata(): Promise<GoogleSpreadsheetMetadata> {
  const { spreadsheetId, accessToken } = await activeContext();
  const url = new URL(`${SHEETS_API}/spreadsheets/${spreadsheetId}`);
  url.searchParams.set(
    "fields",
    "spreadsheetId,properties.title,sheets.properties(sheetId,title,hidden,gridProperties(rowCount,columnCount))",
  );

  return googleRequest<GoogleSpreadsheetMetadata>(
    url.toString(),
    accessToken,
  );
}

export async function getSheetValues(
  range: string,
  options: {
    valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
    dateTimeRenderOption?: "SERIAL_NUMBER" | "FORMATTED_STRING";
  } = {},
): Promise<unknown[][]> {
  const { spreadsheetId, accessToken } = await activeContext();
  const encodedRange = encodeURIComponent(range);
  const url = new URL(
    `${SHEETS_API}/spreadsheets/${spreadsheetId}/values/${encodedRange}`,
  );
  url.searchParams.set(
    "valueRenderOption",
    options.valueRenderOption || "UNFORMATTED_VALUE",
  );
  url.searchParams.set(
    "dateTimeRenderOption",
    options.dateTimeRenderOption || "FORMATTED_STRING",
  );

  const response = await googleRequest<{ values?: unknown[][] }>(
    url.toString(),
    accessToken,
  );
  return response.values || [];
}

export async function batchUpdateSpreadsheet(
  requests: Record<string, unknown>[],
): Promise<{
  spreadsheetId: string;
  replies?: unknown[];
}> {
  const { spreadsheetId, accessToken } = await activeContext();

  return googleRequest(
    `${SHEETS_API}/spreadsheets/${spreadsheetId}:batchUpdate`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        requests,
        includeSpreadsheetInResponse: false,
      }),
    },
  );
}

export function findSheet(
  metadata: GoogleSpreadsheetMetadata,
  title: string,
): GoogleSheetProperties | null {
  return (
    metadata.sheets
      ?.map((sheet) => sheet.properties)
      .find((sheet) => sheet.title === title) || null
  );
}

export function findSheetById(
  metadata: GoogleSpreadsheetMetadata,
  sheetId: number,
): GoogleSheetProperties | null {
  return (
    metadata.sheets
      ?.map((sheet) => sheet.properties)
      .find((sheet) => sheet.sheetId === sheetId) || null
  );
}
