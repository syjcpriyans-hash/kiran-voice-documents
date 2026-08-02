import { NextResponse } from "next/server";
import { z } from "zod";
import {
  batchUpdateSpreadsheet,
  findSheet,
  getSheetValues,
  getSpreadsheetMetadata,
  quoteSheetName,
} from "@/lib/google-sheets";
import { lookupReturnTarget, SYSTEM_LOG } from "@/lib/return-workflow";
import { groupContiguousRows, updateRangeRequest } from "@/lib/sheet-write";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  requestId: z.string().uuid(),
  reference: z.string().min(1).max(150),
  reason: z.string().min(3).max(500),
});

function indiaIso(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+05:30`;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const target = await lookupReturnTarget(input.reference);

    if (target.voided) {
      return NextResponse.json({
        result: {
          ...target,
          isNew: false,
          message: `Memo ${target.memoNumber} is already void${target.voidReason ? `: ${target.voidReason}` : "."}`,
        },
      });
    }

    if (target.alreadyReturned) {
      throw new Error("A returned memorandum cannot be voided automatically. Review it manually with the administrator.");
    }

    if (target.source !== "SYSTEM_LOG" || !target.logRow || !target.memoRows.length || !target.sheet1Rows.length) {
      throw new Error("Only memorandums created by this app can be voided safely because both MEMO and SHEET1 links are required.");
    }

    const metadata = await getSpreadsheetMetadata();
    const memo = findSheet(metadata, "MEMO");
    const sheet1 = findSheet(metadata, "SHEET1");
    const log = findSheet(metadata, SYSTEM_LOG);
    if (!memo || !sheet1 || !log) throw new Error("MEMO, SHEET1 or _SYSTEM_LOG is missing.");

    const [sheet1Remarks, logRows] = await Promise.all([
      getSheetValues(`${quoteSheetName("SHEET1")}!M1:M5000`, { valueRenderOption: "FORMATTED_VALUE" }),
      getSheetValues(`${quoteSheetName(SYSTEM_LOG)}!A1:S5000`, { valueRenderOption: "FORMATTED_VALUE" }),
    ]);

    for (let index = 1; index < logRows.length; index += 1) {
      if (text(logRows[index]?.[18]) === input.requestId) {
        return NextResponse.json({
          result: { ...target, voided: true, isNew: false, message: `Memo ${target.memoNumber} void request was already processed.` },
        });
      }
    }

    const timestamp = indiaIso();
    const requests: Record<string, unknown>[] = [];

    const logColumnCount = log.gridProperties?.columnCount || 0;
    if (logColumnCount < 19) {
      requests.push({
        appendDimension: {
          sheetId: log.sheetId,
          dimension: "COLUMNS",
          length: 19 - logColumnCount,
        },
      });
    }
    if (text(logRows[0]?.[15]) !== "VOID STATUS") {
      requests.push(
        updateRangeRequest(log.sheetId, 1, 15, [["VOID STATUS", "VOIDED AT", "VOID REASON", "VOID REQUEST ID"]]),
      );
    }

    for (const group of groupContiguousRows(target.memoRows)) {
      const count = group.end - group.start + 1;
      requests.push(
        updateRangeRequest(memo.sheetId, group.start, 11, Array.from({ length: count }, () => ["VOID"])),
      );
    }

    for (const rowNumber of target.sheet1Rows) {
      const existingRemark = text(sheet1Remarks[rowNumber - 1]?.[0]);
      const voidText = `VOID: ${input.reason}`;
      const updatedRemark = existingRemark
        ? existingRemark.toUpperCase().includes("VOID:")
          ? existingRemark
          : `${existingRemark} | ${voidText}`
        : voidText;
      requests.push(updateRangeRequest(sheet1.sheetId, rowNumber, 12, [[updatedRemark]]));
    }

    requests.push(
      updateRangeRequest(log.sheetId, target.logRow, 1, [["VOID"]]),
      updateRangeRequest(log.sheetId, target.logRow, 15, [["VOID", timestamp, input.reason, input.requestId]]),
    );

    await batchUpdateSpreadsheet(requests);

    return NextResponse.json({
      result: {
        ...target,
        voided: true,
        voidedAt: timestamp,
        voidReason: input.reason,
        isNew: true,
        message: `Memo ${target.memoNumber} was marked VOID in MEMO, SHEET1 and the audit log. No rows were deleted.`,
      },
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json({ error: cause.issues[0]?.message || "Void details are incomplete." }, { status: 400 });
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "The memorandum could not be voided." },
      { status: 500 },
    );
  }
}
