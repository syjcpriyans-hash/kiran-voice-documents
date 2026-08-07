import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getConnectedGoogleAccessToken } from "@/lib/google-oauth";
import {
  inspectSpreadsheet,
  SHEET_CONNECTION_COOKIE,
  validateConnectionConfig,
  type SheetConnectionConfig,
} from "@/lib/sheet-connection";
import { sealJson, secureCookieOptions } from "@/lib/connection-crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const roleSchema = z.object({
  sheetId: z.number().int(),
  sheetName: z.string(),
  headerRow: z.number().int().min(1).max(200),
  columns: z.record(z.string(), z.number().int().min(0).max(199)),
});

const schema = z.object({
  version: z.literal(1),
  spreadsheetId: z.string().min(10).max(300),
  spreadsheetTitle: z.string().min(1).max(500),
  connectedAt: z.string(),
  memo: roleSchema,
  tracking: roleSchema,
  master: roleSchema.optional(),
});

export async function POST(request: Request) {
  try {
    const config = schema.parse(await request.json()) as SheetConnectionConfig;
    const accessToken = await getConnectedGoogleAccessToken();
    const inspection = await inspectSpreadsheet(
      config.spreadsheetId,
      accessToken,
    );
    const validated = validateConnectionConfig(config, inspection);

    if (!inspection.canEdit) {
      throw new Error(
        "The selected Google Sheet is no longer editable by this Google account.",
      );
    }

    const response = NextResponse.json({
      connected: true,
      spreadsheetTitle: validated.spreadsheetTitle,
    });
    response.cookies.set(
      SHEET_CONNECTION_COOKIE,
      sealJson(validated),
      {
        ...secureCookieOptions,
        maxAge: 60 * 60 * 24 * 365,
      },
    );

    return response;
  } catch (cause) {
    if (cause instanceof ZodError) {
      return NextResponse.json(
        { error: "The worksheet mapping is incomplete." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "The worksheet mapping could not be saved.",
      },
      { status: 400 },
    );
  }
}
