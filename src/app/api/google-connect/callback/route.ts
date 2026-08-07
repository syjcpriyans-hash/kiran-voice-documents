import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeAuthorizationCode,
  GOOGLE_AUTH_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "@/lib/google-oauth";
import {
  sealJson,
  secureCookieOptions,
  unsealJson,
} from "@/lib/connection-crypto";

export const runtime = "nodejs";

type StateCookie = {
  state: string;
  returnTo: string;
  createdAt: number;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");

  const cookieStore = await cookies();
  const stored = unsealJson<StateCookie>(
    cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value,
  );
  const returnTo = stored?.returnTo || "/connect-sheet";

  if (
    error ||
    !code ||
    !state ||
    !stored ||
    stored.state !== state ||
    Date.now() - stored.createdAt > 10 * 60 * 1000
  ) {
    const message =
      error ||
      "Google authorization could not be verified. Start the connection again.";
    return NextResponse.redirect(
      new URL(`${returnTo}?error=${encodeURIComponent(message)}`, request.url),
    );
  }

  try {
    const session = await exchangeAuthorizationCode(code);
    const response = NextResponse.redirect(
      new URL(`${returnTo}?authorized=1`, request.url),
    );

    response.cookies.set(GOOGLE_AUTH_COOKIE, sealJson(session), {
      ...secureCookieOptions,
      maxAge: 60 * 60 * 24 * 365,
    });
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
      ...secureCookieOptions,
      maxAge: 0,
    });

    return response;
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Google authorization could not be completed.";
    return NextResponse.redirect(
      new URL(`${returnTo}?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
