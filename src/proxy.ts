import { Buffer } from "node:buffer";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const username = process.env.APP_BASIC_USER;
  const password = process.env.APP_BASIC_PASSWORD;

  if (!username || !password) {
    return new NextResponse(
      "App access is not configured. Add APP_BASIC_USER and APP_BASIC_PASSWORD in Vercel.",
      { status: 503 },
    );
  }

  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const supplied = request.headers.get("authorization");

  if (supplied === expected) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Kiran Voice Documents", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)",
  ],
};
