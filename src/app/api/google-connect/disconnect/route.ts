import { NextResponse } from "next/server";
import {
  getStoredOAuthSession,
  GOOGLE_AUTH_COOKIE,
} from "@/lib/google-oauth";
import { SHEET_CONNECTION_COOKIE } from "@/lib/sheet-connection";
import { secureCookieOptions } from "@/lib/connection-crypto";

export const runtime = "nodejs";

export async function POST() {
  const session = await getStoredOAuthSession();

  if (session?.refreshToken) {
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(
          session.refreshToken,
        )}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          cache: "no-store",
        },
      );
    } catch {
      // The local connection is still removed even if Google revocation is temporarily unavailable.
    }
  }

  const response = NextResponse.json({ disconnected: true });

  for (const name of [GOOGLE_AUTH_COOKIE, SHEET_CONNECTION_COOKIE]) {
    response.cookies.set(name, "", {
      ...secureCookieOptions,
      maxAge: 0,
    });
  }

  return response;
}
