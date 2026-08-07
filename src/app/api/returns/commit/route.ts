import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  batchUpdateSpreadsheet,
  findSheet,
  getSheetValues,
  quoteSheetName,
} from "@/lib/google-sheets";
import { lookupReturnTarget, SYSTEM_LOG } from "@/lib/return-workflow";
import { resolveConnectedSheets } from "@/lib/mapped-sheet";
import {
  dateToGoogleSerial,
  groupContiguousRows,
  numberFormatRequest,
  updateRangeRequest,
} from "@/lib/sheet-write";

export const runtime = "nodejs";
export const maxDuration = 60;

const LOG_COLUMNS = 19;

const requestSchema = z.object({
  requestId: z.string().uuid(),
  reference: z.string().min(1).max(150),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confirmPerson: z.string().min(1).max(150),
});

type Input = {
  requestId: string;
  reference: string;
  returnDate: string;
  confirmPerson: string;
};

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

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}:${get("second")}`;

  return { date, time, iso: `${date}T${time}+05:30` };
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json()) as Input;
    const target = await lookupReturnTarget(input.reference);

    if (target.voided) {
      throw new Error(
        `Memorandum ${target.memoNumber} is void and cannot be marked returned.`,
      );
    }

    if (!target.canUpdateSheet1 || !target.sheet1Rows.length) {
      throw new Error(
        target.warning ||
          "A safe tracking-row link was not found. Use the official memorandum number.",
      );
    }

    if (target.alreadyReturned) {
      return NextResponse.json({
        result: {
          ...target,
          isNew: false,
          message: `Memorandum ${target.memoNumber} was already marked returned${
            target.returnDate ? ` on ${target.returnDate}` : ""
          }.`,
        },
      });
    }

    const connected = await resolveConnectedSheets();
    const trackingColumns = connected.config.tracking.columns;
    const memoColumns = connected.config.memo.columns;
    const log = findSheet(connected.metadata, SYSTEM_LOG);

    const logRows = log
      ? await getSheetValues(`${quoteSheetName(SYSTEM_LOG)}!A1:S10000`, {
          valueRenderOption: "FORMATTED_VALUE",
        })
      : [];

    for (let index = 1; index < logRows.length; index += 1) {
      if (String(logRows[index]?.[14] || "").trim() === input.requestId) {
        return NextResponse.json({
          result: {
            ...target,
            isNew: false,
            message: `Memorandum ${target.memoNumber} return update was already processed.`,
          },
        });
      }
    }

    const returnedSerial = dateToGoogleSerial(input.returnDate);
    const confirmation = indiaDateTime();
    const confirmationSerial = dateToGoogleSerial(confirmation.date);
    const requests: Record<string, unknown>[] = [];

    if (log) {
      const currentColumnCount = log.gridProperties?.columnCount || 0;
      if (currentColumnCount < LOG_COLUMNS) {
        requests.push({
          appendDimension: {
            sheetId: log.sheetId,
            dimension: "COLUMNS",
            length: LOG_COLUMNS - currentColumnCount,
          },
        });
      }

      if (
        String(logRows[0]?.[11] || "").trim().toUpperCase() !==
        "RETURN STATUS"
      ) {
        requests.push(
          updateRangeRequest(log.sheetId, 1, 11, [[
            "RETURN STATUS",
            "RETURNED AT",
            "CONFIRM PERSON",
            "RETURN REQUEST ID",
            "VOID STATUS",
            "VOIDED AT",
            "VOID REASON",
            "VOID REQUEST ID",
          ]]),
        );
      }
    }

    for (const group of groupContiguousRows(target.sheet1Rows)) {
      const count = group.end - group.start + 1;

      requests.push(
        updateRangeRequest(
          connected.tracking.sheetId,
          group.start,
          trackingColumns.returnDate,
          Array.from({ length: count }, () => [returnedSerial]),
        ),
        numberFormatRequest(
          connected.tracking.sheetId,
          group.start,
          count,
          trackingColumns.returnDate,
          "DATE",
          "dd-mmm-yy",
        ),
      );

      if (Number.isInteger(trackingColumns.confirmPerson)) {
        requests.push(
          updateRangeRequest(
            connected.tracking.sheetId,
            group.start,
            trackingColumns.confirmPerson as number,
            Array.from({ length: count }, () => [input.confirmPerson]),
          ),
        );
      }

      if (Number.isInteger(trackingColumns.confirmDate)) {
        requests.push(
          updateRangeRequest(
            connected.tracking.sheetId,
            group.start,
            trackingColumns.confirmDate as number,
            Array.from({ length: count }, () => [confirmationSerial]),
          ),
          numberFormatRequest(
            connected.tracking.sheetId,
            group.start,
            count,
            trackingColumns.confirmDate as number,
            "DATE",
            "dd-mmm-yy",
          ),
        );
      }

      if (Number.isInteger(trackingColumns.confirmTime)) {
        requests.push(
          updateRangeRequest(
            connected.tracking.sheetId,
            group.start,
            trackingColumns.confirmTime as number,
            Array.from({ length: count }, () => [confirmation.time]),
          ),
        );
      }
    }

    if (
      target.canUpdateMemo &&
      target.memoRows.length &&
      Number.isInteger(memoColumns.status)
    ) {
      for (const group of groupContiguousRows(target.memoRows)) {
        const count = group.end - group.start + 1;
        requests.push(
          updateRangeRequest(
            connected.memo.sheetId,
            group.start,
            memoColumns.status as number,
            Array.from({ length: count }, () => ["RETURNED"]),
          ),
        );
      }
    }

    if (log && target.logRow) {
      requests.push(
        updateRangeRequest(log.sheetId, target.logRow, 11, [[
          "RETURNED",
          confirmation.iso,
          input.confirmPerson,
          input.requestId,
        ]]),
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
        message: `Memorandum ${target.memoNumber} was marked returned in the tracking worksheet${
          target.canUpdateMemo ? " and memorandum worksheet" : ""
        }.`,
      },
    });
  } catch (cause) {
    if (cause instanceof ZodError) {
      return NextResponse.json(
        {
          error:
            cause.issues[0]?.message || "Return details are incomplete.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "The return update failed.",
      },
      { status: 500 },
    );
  }
}
