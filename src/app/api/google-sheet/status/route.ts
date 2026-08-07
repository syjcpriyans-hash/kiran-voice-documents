import { NextResponse } from "next/server";
import {
  getStoredSheetConnection,
  legacySheetConnection,
} from "@/lib/sheet-connection";
import { getStoredOAuthSession } from "@/lib/google-oauth";
import { resolveConnectedSheets } from "@/lib/mapped-sheet";

export const runtime = "nodejs";

export async function GET() {
  let authorized = false;
  let mode: "oauth" | "legacy" | "none" = "none";

  try {
    const [storedConnection, oauthSession] = await Promise.all([
      getStoredSheetConnection(),
      getStoredOAuthSession(),
    ]);

    authorized = Boolean(oauthSession);
    mode = storedConnection
      ? "oauth"
      : legacySheetConnection()
        ? "legacy"
        : "none";

    if (mode === "none") {
      return NextResponse.json({
        connected: false,
        authorized,
        mode,
      });
    }

    const connected = await resolveConnectedSheets();

    return NextResponse.json({
      connected: true,
      authorized,
      mode: connected.mode,
      spreadsheetTitle:
        connected.metadata.properties?.title ||
        connected.config.spreadsheetTitle,
      sheets:
        connected.metadata.sheets?.map((sheet) => sheet.properties.title) || [],
      mapping: {
        memorandumWorksheet: connected.memo.title,
        trackingWorksheet: connected.tracking.title,
        masterWorksheet: connected.master?.title || null,
      },
    });
  } catch (cause) {
    return NextResponse.json(
      {
        connected: false,
        authorized,
        mode,
        error:
          cause instanceof Error
            ? cause.message
            : "Google Sheet connection failed.",
      },
      { status: 503 },
    );
  }
}
