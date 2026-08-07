import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  batchUpdateSpreadsheet,
  findSheet,
  getSheetValues,
  quoteSheetName,
} from "@/lib/google-sheets";
import { lookupReturnTarget, SYSTEM_LOG } from "@/lib/return-workflow";
import {
  mappedCell,
  resolveConnectedSheets,
  lastMappedColumnLetter,
} from "@/lib/mapped-sheet";
import {
  groupContiguousRows,
  updateRangeRequest,
} from "@/lib/sheet-write";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  requestId: z.string().uuid(),
  reference: z.string().min(1).max(150),
  reason: z.string().min(3).max(500),
});

type Input = {
  requestId: string;
  reference: string;
  reason: string;
};

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

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get(
    "minute",
  )}:${get("second")}+05:30`;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json()) as Input;
    const target = await lookupReturnTarget(input.reference);

    if (target.voided) {
      return NextResponse.json({
        result: {
          ...target,
          isNew: false,
          message: `Memorandum ${target.memoNumber} is already void${
            target.voidReason ? `: ${target.voidReason}` : "."
          }`,
        },
      });
    }

    if (target.alreadyReturned) {
      throw new Error(
        "A returned memorandum cannot be voided automatically. Review it manually with the administrator.",
      );
    }

    if (
      target.source !== "SYSTEM_LOG" ||
      !target.logRow ||
      !target.memoRows.length ||
      !target.sheet1Rows.length
    ) {
      throw new Error(
        "Only memorandums created by this application can be voided safely because both business-row links are required.",
      );
    }

    const connected = await resolveConnectedSheets();
    const memoColumns = connected.config.memo.columns;
    const trackingColumns = connected.config.tracking.columns;
    const trackingLastColumn = lastMappedColumnLetter(trackingColumns);
    const log = findSheet(connected.metadata, SYSTEM_LOG);

    if (!log) {
      throw new Error("The internal audit log is missing.");
    }

    if (
      !Number.isInteger(memoColumns.status) &&
      !Number.isInteger(trackingColumns.remarks)
    ) {
      throw new Error(
        "The connected spreadsheet has no mapped status or remarks column for recording a void. Reconnect the sheet and review the mapping.",
      );
    }

    const [trackingRows, logRows] = await Promise.all([
      getSheetValues(
        `${quoteSheetName(connected.tracking.title)}!A1:${trackingLastColumn}10000`,
        { valueRenderOption: "FORMATTED_VALUE" },
      ),
      getSheetValues(`${quoteSheetName(SYSTEM_LOG)}!A1:S10000`, {
        valueRenderOption: "FORMATTED_VALUE",
      }),
    ]);

    for (let index = 1; index < logRows.length; index += 1) {
      if (text(logRows[index]?.[18]) === input.requestId) {
        return NextResponse.json({
          result: {
            ...target,
            voided: true,
            isNew: false,
            message: `Memorandum ${target.memoNumber} void request was already processed.`,
          },
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
        updateRangeRequest(log.sheetId, 1, 15, [[
          "VOID STATUS",
          "VOIDED AT",
          "VOID REASON",
          "VOID REQUEST ID",
        ]]),
      );
    }

    if (Number.isInteger(memoColumns.status)) {
      for (const group of groupContiguousRows(target.memoRows)) {
        const count = group.end - group.start + 1;
        requests.push(
          updateRangeRequest(
            connected.memo.sheetId,
            group.start,
            memoColumns.status as number,
            Array.from({ length: count }, () => ["VOID"]),
          ),
        );
      }
    }

    if (Number.isInteger(trackingColumns.remarks)) {
      for (const rowNumber of target.sheet1Rows) {
        const existingRemark = mappedCell(
          trackingRows[rowNumber - 1] || [],
          trackingColumns.remarks,
        );
        const voidText = `VOID: ${input.reason}`;
        const updatedRemark = existingRemark
          ? existingRemark.toUpperCase().includes("VOID:")
            ? existingRemark
            : `${existingRemark} | ${voidText}`
          : voidText;

        requests.push(
          updateRangeRequest(
            connected.tracking.sheetId,
            rowNumber,
            trackingColumns.remarks as number,
            [[updatedRemark]],
          ),
        );
      }
    }

    requests.push(
      updateRangeRequest(log.sheetId, target.logRow, 1, [["VOID"]]),
      updateRangeRequest(log.sheetId, target.logRow, 15, [[
        "VOID",
        timestamp,
        input.reason,
        input.requestId,
      ]]),
    );

    await batchUpdateSpreadsheet(requests);

    return NextResponse.json({
      result: {
        ...target,
        voided: true,
        voidedAt: timestamp,
        voidReason: input.reason,
        isNew: true,
        message: `Memorandum ${target.memoNumber} was marked void without deleting any business history.`,
      },
    });
  } catch (cause) {
    if (cause instanceof ZodError) {
      return NextResponse.json(
        {
          error:
            cause.issues[0]?.message || "Void details are incomplete.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "The memorandum could not be voided.",
      },
      { status: 500 },
    );
  }
}
