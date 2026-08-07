import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildGoogleAuthorizationUrl,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "@/lib/google-oauth";
import { sealJson, secureCookieOptions } from "@/lib/connection-crypto";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const returnTo = url.searchParams.get("returnTo") || "/connect-sheet";
    const state = randomBytes(24).toString("hex");

    const response = NextResponse.redirect(buildGoogleAuthorizationUrl(state));
    response.cookies.set(
      GOOGLE_OAUTH_STATE_COOKIE,
      sealJson({
        state,
        returnTo: returnTo.startsWith("/") ? returnTo : "/connect-sheet",
        createdAt: Date.now(),
      }),
      {
        ...secureCookieOptions,
        maxAge: 10 * 60,
      },
    );

    return response;
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Google connection could not start.";
    return NextResponse.redirect(
      new URL(`/connect-sheet?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
