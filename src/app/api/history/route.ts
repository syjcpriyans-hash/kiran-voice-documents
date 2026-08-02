import { NextResponse } from "next/server";
import { findSheet, getSheetValues, getSpreadsheetMetadata, quoteSheetName } from "@/lib/google-sheets";
import { SYSTEM_LOG } from "@/lib/return-workflow";
import type { HistoryRecord } from "@/lib/types";

export const runtime = "nodejs";

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export async function GET(request: Request) {
  try {
    const metadata = await getSpreadsheetMetadata();
    const log = findSheet(metadata, SYSTEM_LOG);
    if (!log) return NextResponse.json({ records: [] });

    const rows = await getSheetValues(`${quoteSheetName(SYSTEM_LOG)}!A1:S5000`, {
      valueRenderOption: "FORMATTED_VALUE",
    });
    const query = new URL(request.url).searchParams.get("q")?.trim().toUpperCase() || "";
    const records: HistoryRecord[] = [];

    for (let index = rows.length - 1; index >= 1 && records.length < 200; index -= 1) {
      const row = rows[index] || [];
      const status = text(row[1]);
      if (!status) continue;

      let document: HistoryRecord["document"] = null;
      try {
        document = JSON.parse(text(row[9])) as HistoryRecord["document"];
      } catch {
        document = null;
      }

      const record: HistoryRecord = {
        requestId: text(row[0]),
        status,
        memoNumber: text(row[2]),
        memoRows: text(row[3]),
        sheet1Rows: text(row[4]),
        totalCarats: Number(row[5] || 0),
        recipient: text(row[6]),
        createdAt: text(row[7]),
        returnedStatus: text(row[11]) || undefined,
        returnedAt: text(row[12]) || undefined,
        confirmPerson: text(row[13]) || undefined,
        voidStatus: text(row[15]) || undefined,
        voidedAt: text(row[16]) || undefined,
        voidReason: text(row[17]) || undefined,
        document,
      };

      const haystack = [record.memoNumber, record.recipient, record.createdAt, record.returnedStatus, record.confirmPerson, record.voidStatus, record.voidReason]
        .filter(Boolean)
        .join(" ")
        .toUpperCase();
      if (!query || haystack.includes(query)) records.push(record);
    }

    return NextResponse.json({ records });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "History could not be loaded." },
      { status: 500 },
    );
  }
}
