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
import {
  dateToGoogleSerial,
  groupContiguousRows,
  numberFormatRequest,
  updateRangeRequest,
} from "@/lib/sheet-write";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  requestId: z.string().uuid(),
  reference: z.string().min(1).max(150),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confirmPerson: z.string().min(1).max(150),
});

function indiaDateTime(): { date: string; time: string; iso: string } {
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
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}:${get("second")}`;
  return { date, time, iso: `${date}T${time}+05:30` };
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const target = await lookupReturnTarget(input.reference);

    if (target.voided) {
      throw new Error(`Memo ${target.memoNumber} is void and cannot be marked returned.`);
    }

    if (!target.canUpdateSheet1 || !target.sheet1Rows.length) {
      throw new Error(target.warning || "A safe SHEET1 link was not found. Use the official SHEET1 memo number.");
    }

    if (target.alreadyReturned) {
      return NextResponse.json({
        result: {
          ...target,
          isNew: false,
          message: `Memo ${target.memoNumber} was already marked returned${target.returnDate ? ` on ${target.returnDate}` : ""}.`,
        },
      });
    }

    const metadata = await getSpreadsheetMetadata();
    const sheet1 = findSheet(metadata, "SHEET1");
    const memo = findSheet(metadata, "MEMO");
    const log = findSheet(metadata, SYSTEM_LOG);
    if (!sheet1 || !memo) throw new Error("MEMO or SHEET1 is missing from the Google Sheet.");

    const logRows = log
      ? await getSheetValues(`${quoteSheetName(SYSTEM_LOG)}!A1:S5000`, { valueRenderOption: "FORMATTED_VALUE" })
      : [];

    for (let index = 1; index < logRows.length; index += 1) {
      if (String(logRows[index]?.[14] || "").trim() === input.requestId) {
        return NextResponse.json({
          result: { ...target, isNew: false, message: `Memo ${target.memoNumber} return update was already processed.` },
        });
      }
    }

    const returnedSerial = dateToGoogleSerial(input.returnDate);
    const confirmation = indiaDateTime();
    const confirmationSerial = dateToGoogleSerial(confirmation.date);
    const requests: Record<string, unknown>[] = [];

    for (const group of groupContiguousRows(target.sheet1Rows)) {
      const count = group.end - group.start + 1;
      requests.push(
        updateRangeRequest(sheet1.sheetId, group.start, 1, Array.from({ length: count }, () => [returnedSerial])),
        updateRangeRequest(
          sheet1.sheetId,
          group.start,
          13,
          Array.from({ length: count }, () => [input.confirmPerson, confirmationSerial, confirmation.time]),
        ),
        numberFormatRequest(sheet1.sheetId, group.start, count, 1, "DATE", "dd-mmm-yy"),
        numberFormatRequest(sheet1.sheetId, group.start, count, 14, "DATE", "dd-mmm-yy"),
      );
    }

    if (target.canUpdateMemo && target.memoRows.length) {
      for (const group of groupContiguousRows(target.memoRows)) {
        const count = group.end - group.start + 1;
        requests.push(
          updateRangeRequest(memo.sheetId, group.start, 11, Array.from({ length: count }, () => ["RETURNED"])),
        );
      }
    }

    if (log && target.logRow) {
      requests.push(
        updateRangeRequest(log.sheetId, target.logRow, 11, [["RETURNED", confirmation.iso, input.confirmPerson, input.requestId]]),
      );
    }

    await batchUpdateSpreadsheet(requests);

    return NextResponse.json({
      result: {
        ...target,
        alreadyReturned: true,
        returnDate: input.returnDate,
        confirmPerson: input.confirmPerson,
        isNew: true,
        message: `Memo ${target.memoNumber} was marked returned in SHEET1${target.canUpdateMemo ? " and MEMO" : ""}.`,
      },
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json({ error: cause.issues[0]?.message || "Return details are incomplete." }, { status: 400 });
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "The return update failed." },
      { status: 500 },
    );
  }
}
