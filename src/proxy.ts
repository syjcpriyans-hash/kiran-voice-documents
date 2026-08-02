import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Public app access.
 *
 * The former Basic Authentication password gate has been removed.
 * Keep this pass-through proxy so the existing project structure remains valid.
 */
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)",
  ],
};
