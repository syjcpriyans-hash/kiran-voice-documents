import {
  findSheet,
  getSheetValues,
  quoteSheetName,
} from "@/lib/google-sheets";
import {
  mappedCell,
  resolveConnectedSheets,
  lastMappedColumnLetter,
} from "@/lib/mapped-sheet";
import { SYSTEM_LOG_SHEET } from "@/lib/sheet-connection";
import type { ReturnLookupResult } from "@/lib/types";

export const SYSTEM_LOG = SYSTEM_LOG_SHEET;

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeReference(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "").trim();
}

export function parseRowLabel(value: string): number[] {
  const match = value.trim().match(/^(\d+)(?::(\d+))?$/);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2] || match[1]);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end - start > 100
  ) {
    return [];
  }
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function memoBase(value: unknown): string {
  const raw = text(value);
  const match = raw.match(/^(\d+)(?:\.\d+)?$/);
  return match?.[1] || "";
}

function getRow(values: unknown[][], rowNumber: number): unknown[] {
  return values[rowNumber - 1] || [];
}

export type ReturnTarget = ReturnLookupResult & {
  logRow?: number;
};

export async function lookupReturnTarget(
  referenceInput: string,
): Promise<ReturnTarget> {
  const reference = referenceInput.trim();
  if (!reference) {
    throw new Error(
      "Enter an internal memorandum number or official memorandum number.",
    );
  }

  const connected = await resolveConnectedSheets();
  const memoColumns = connected.config.memo.columns;
  const trackingColumns = connected.config.tracking.columns;
  const logSheet = findSheet(connected.metadata, SYSTEM_LOG_SHEET);
  const memoLastColumn = lastMappedColumnLetter(memoColumns);
  const trackingLastColumn = lastMappedColumnLetter(trackingColumns);

  const [memoRows, trackingRows, logRows] = await Promise.all([
    getSheetValues(`${quoteSheetName(connected.memo.title)}!A1:${memoLastColumn}20000`, {
      valueRenderOption: "FORMATTED_VALUE",
    }),
    getSheetValues(`${quoteSheetName(connected.tracking.title)}!A1:${trackingLastColumn}10000`, {
      valueRenderOption: "FORMATTED_VALUE",
    }),
    logSheet
      ? getSheetValues(`${quoteSheetName(SYSTEM_LOG_SHEET)}!A1:S10000`, {
          valueRenderOption: "FORMATTED_VALUE",
        })
      : Promise.resolve([] as unknown[][]),
  ]);

  const normalized = normalizeReference(reference);

  for (let index = 1; index < logRows.length; index += 1) {
    const row = logRows[index] || [];
    const status = text(row[1]).toUpperCase();

    if (
      normalizeReference(text(row[2])) !== normalized ||
      !["COMPLETE", "VOID"].includes(status)
    ) {
      continue;
    }

    const linkedMemoRows = parseRowLabel(text(row[3]));
    const linkedTrackingRows = parseRowLabel(text(row[4]));
    const documentJson = text(row[9]);
    let recipient = text(row[6]);
    let through = "";

    try {
      const parsed = JSON.parse(documentJson) as {
        recipientName?: string;
        through?: string;
      };
      recipient = parsed.recipientName || recipient;
      through = parsed.through || "";
    } catch {
      // Historical audit rows can be missing structured JSON.
    }

    const trackingReturned =
      linkedTrackingRows.length > 0 &&
      linkedTrackingRows.every((rowNumber) =>
        Boolean(
          mappedCell(
            getRow(trackingRows, rowNumber),
            trackingColumns.returnDate,
          ),
        ),
      );

    const memoReturned =
      Number.isInteger(memoColumns.status) &&
      linkedMemoRows.length > 0 &&
      linkedMemoRows.every(
        (rowNumber) =>
          mappedCell(
            getRow(memoRows, rowNumber),
            memoColumns.status,
          ).toUpperCase() === "RETURNED",
      );

    const returnDate = linkedTrackingRows.length
      ? mappedCell(
          getRow(trackingRows, linkedTrackingRows[0]),
          trackingColumns.returnDate,
        )
      : "";
    const voided =
      status === "VOID" || text(row[15]).toUpperCase() === "VOID";

    return {
      reference,
      memoNumber: text(row[2]),
      recipient,
      through,
      memoRows: linkedMemoRows,
      sheet1Rows: linkedTrackingRows,
      itemCount: Math.max(linkedMemoRows.length, linkedTrackingRows.length),
      alreadyReturned: Boolean(
        trackingReturned ||
          memoReturned ||
          text(row[11]).toUpperCase() === "RETURNED",
      ),
      returnDate: returnDate || undefined,
      voided,
      voidedAt: text(row[16]) || undefined,
      voidReason: text(row[17]) || undefined,
      canUpdateMemo:
        linkedMemoRows.length > 0 && Number.isInteger(memoColumns.status),
      canUpdateSheet1:
        linkedTrackingRows.length > 0 &&
        Number.isInteger(trackingColumns.returnDate),
      source: "SYSTEM_LOG",
      logRow: index + 1,
    };
  }

  if (Number.isInteger(trackingColumns.memoNumber)) {
    const officialRows: number[] = [];

    for (
      let index = connected.config.tracking.headerRow;
      index < trackingRows.length;
      index += 1
    ) {
      if (
        normalizeReference(
          mappedCell(trackingRows[index] || [], trackingColumns.memoNumber),
        ) === normalized
      ) {
        officialRows.push(index + 1);
      }
    }

    if (officialRows.length) {
      const first = getRow(trackingRows, officialRows[0]);
      const alreadyReturned = officialRows.every((rowNumber) =>
        Boolean(
          mappedCell(
            getRow(trackingRows, rowNumber),
            trackingColumns.returnDate,
          ),
        ),
      );

      return {
        reference,
        memoNumber: mappedCell(first, trackingColumns.memoNumber),
        recipient: mappedCell(first, trackingColumns.customer),
        through: mappedCell(first, trackingColumns.through),
        memoRows: [],
        sheet1Rows: officialRows,
        itemCount: officialRows.length,
        alreadyReturned,
        returnDate:
          mappedCell(first, trackingColumns.returnDate) || undefined,
        voided: false,
        canUpdateMemo: false,
        canUpdateSheet1: true,
        source: "SHEET1",
        warning:
          "This is a historical tracking record. The tracking worksheet can be updated safely, but no exact memorandum-row link is available.",
      };
    }
  }

  if (/^\d+(?:\.\d+)?$/.test(reference)) {
    const base = String(Math.floor(Number(reference)));
    const matchedMemoRows: number[] = [];

    for (
      let index = connected.config.memo.headerRow;
      index < memoRows.length;
      index += 1
    ) {
      if (
        memoBase(mappedCell(memoRows[index] || [], memoColumns.memoLine)) ===
        base
      ) {
        matchedMemoRows.push(index + 1);
      }
    }

    if (matchedMemoRows.length) {
      const first = getRow(memoRows, matchedMemoRows[0]);
      const statusAvailable = Number.isInteger(memoColumns.status);

      return {
        reference,
        memoNumber: base,
        recipient: mappedCell(first, memoColumns.recipient),
        through: mappedCell(first, memoColumns.through),
        memoRows: matchedMemoRows,
        sheet1Rows: [],
        itemCount: matchedMemoRows.length,
        alreadyReturned:
          statusAvailable &&
          matchedMemoRows.every(
            (rowNumber) =>
              mappedCell(
                getRow(memoRows, rowNumber),
                memoColumns.status,
              ).toUpperCase() === "RETURNED",
          ),
        voided:
          statusAvailable &&
          matchedMemoRows.every(
            (rowNumber) =>
              mappedCell(
                getRow(memoRows, rowNumber),
                memoColumns.status,
              ).toUpperCase() === "VOID",
          ),
        canUpdateMemo: statusAvailable,
        canUpdateSheet1: false,
        source: "MEMO",
        warning:
          "This historical internal memorandum number has no safe tracking-row link. Use the official memorandum number when available.",
      };
    }
  }

  throw new Error(`No memorandum matching “${reference}” was found.`);
}
