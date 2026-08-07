import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getConnectedGoogleAccessToken } from "@/lib/google-oauth";
import {
  inspectSpreadsheet,
  SHEET_CONNECTION_COOKIE,
} from "@/lib/sheet-connection";
import { sealJson, secureCookieOptions } from "@/lib/connection-crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  spreadsheetId: z.string().min(10).max(300),
});

export async function POST(request: Request) {
  try {
    const { spreadsheetId } = schema.parse(await request.json());
    const accessToken = await getConnectedGoogleAccessToken();
    const inspection = await inspectSpreadsheet(spreadsheetId, accessToken);

    if (!inspection.canEdit) {
      return NextResponse.json(
        {
          error:
            "The selected Google Sheet is not editable by this Google account. Ask the owner for Editor access, then choose it again.",
        },
        { status: 400 },
      );
    }

    if (inspection.ready && inspection.proposed) {
      const response = NextResponse.json({
        connected: true,
        spreadsheetTitle: inspection.spreadsheetTitle,
        warnings: inspection.warnings,
      });
      response.cookies.set(
        SHEET_CONNECTION_COOKIE,
        sealJson(inspection.proposed),
        {
          ...secureCookieOptions,
          maxAge: 60 * 60 * 24 * 365,
        },
      );
      return response;
    }

    return NextResponse.json({
      connected: false,
      needsReview: true,
      inspection,
    });
  } catch (cause) {
    if (cause instanceof ZodError) {
      return NextResponse.json(
        { error: "Choose a valid Google Sheet." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "The selected spreadsheet could not be analyzed.",
      },
      { status: 500 },
    );
  }
}
