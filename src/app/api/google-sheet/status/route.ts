import { NextResponse } from "next/server";
import {
  findSheet,
  getSpreadsheetMetadata,
} from "@/lib/google-sheets";

export const runtime = "nodejs";

const REQUIRED_SHEETS = ["CUT. MASTER", "MEMO", "SHEET1"];

export async function GET() {
  try {
    const metadata = await getSpreadsheetMetadata();
    const sheets =
      metadata.sheets?.map((sheet) => sheet.properties.title) || [];
    const missing = REQUIRED_SHEETS.filter(
      (title) => !findSheet(metadata, title),
    );

    return NextResponse.json({
      connected: missing.length === 0,
      spreadsheetTitle: metadata.properties?.title || "Google Sheet",
      sheets,
      missingSheets: missing,
    });
  } catch (cause) {
    return NextResponse.json(
      {
        connected: false,
        error:
          cause instanceof Error
            ? cause.message
            : "Google Sheet connection failed.",
      },
      { status: 503 },
    );
  }
}
