import {
  findSheet,
  getSheetValues,
  getSpreadsheetMetadata,
  quoteSheetName,
} from "@/lib/google-sheets";
import type { ReturnLookupResult } from "@/lib/types";

export const SYSTEM_LOG = "_SYSTEM_LOG";

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
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start > 100) return [];
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

export async function lookupReturnTarget(referenceInput: string): Promise<ReturnTarget> {
  const reference = referenceInput.trim();
  if (!reference) throw new Error("Enter an internal memo number or official SHEET1 memo number.");

  const metadata = await getSpreadsheetMetadata();
  const memoSheet = findSheet(metadata, "MEMO");
  const sheet1 = findSheet(metadata, "SHEET1");
  if (!memoSheet || !sheet1) throw new Error("The Google Sheet must contain MEMO and SHEET1.");

  const logSheet = findSheet(metadata, SYSTEM_LOG);
  const [memoRows, sheet1Rows, logRows] = await Promise.all([
    getSheetValues(`${quoteSheetName("MEMO")}!A1:N15000`, { valueRenderOption: "FORMATTED_VALUE" }),
    getSheetValues(`${quoteSheetName("SHEET1")}!A1:P5000`, { valueRenderOption: "FORMATTED_VALUE" }),
    logSheet
      ? getSheetValues(`${quoteSheetName(SYSTEM_LOG)}!A1:S5000`, { valueRenderOption: "FORMATTED_VALUE" })
      : Promise.resolve([] as unknown[][]),
  ]);

  const normalized = normalizeReference(reference);

  for (let index = 1; index < logRows.length; index += 1) {
    const row = logRows[index] || [];
    const status = text(row[1]).toUpperCase();
    if (normalizeReference(text(row[2])) !== normalized || !["COMPLETE", "VOID"].includes(status)) continue;

    const linkedMemoRows = parseRowLabel(text(row[3]));
    const linkedSheet1Rows = parseRowLabel(text(row[4]));
    const documentJson = text(row[9]);
    let recipient = text(row[6]);
    let through = "";

    try {
      const parsed = JSON.parse(documentJson) as { recipientName?: string; through?: string };
      recipient = parsed.recipientName || recipient;
      through = parsed.through || "";
    } catch {
      // Older log rows may not contain usable JSON.
    }

    const sheetReturned = linkedSheet1Rows.length > 0 && linkedSheet1Rows.every((rowNumber) => text(getRow(sheet1Rows, rowNumber)[1]));
    const memoReturned = linkedMemoRows.length > 0 && linkedMemoRows.every((rowNumber) => text(getRow(memoRows, rowNumber)[11]).toUpperCase() === "RETURNED");
    const returnDate = linkedSheet1Rows.length ? text(getRow(sheet1Rows, linkedSheet1Rows[0])[1]) : "";
    const voided = status === "VOID" || text(row[15]).toUpperCase() === "VOID";

    return {
      reference,
      memoNumber: text(row[2]),
      recipient,
      through,
      memoRows: linkedMemoRows,
      sheet1Rows: linkedSheet1Rows,
      itemCount: Math.max(linkedMemoRows.length, linkedSheet1Rows.length),
      alreadyReturned: Boolean(sheetReturned || memoReturned || text(row[11]).toUpperCase() === "RETURNED"),
      returnDate: returnDate || undefined,
      voided,
      voidedAt: text(row[16]) || undefined,
      voidReason: text(row[17]) || undefined,
      canUpdateMemo: linkedMemoRows.length > 0,
      canUpdateSheet1: linkedSheet1Rows.length > 0,
      source: "SYSTEM_LOG",
      logRow: index + 1,
    };
  }

  const officialRows: number[] = [];
  for (let index = 1; index < sheet1Rows.length; index += 1) {
    if (normalizeReference(text(sheet1Rows[index]?.[2])) === normalized) officialRows.push(index + 1);
  }

  if (officialRows.length) {
    const first = getRow(sheet1Rows, officialRows[0]);
    const alreadyReturned = officialRows.every((rowNumber) => Boolean(text(getRow(sheet1Rows, rowNumber)[1])));
    return {
      reference,
      memoNumber: text(first[2]),
      recipient: text(first[3]),
      through: text(first[4]),
      memoRows: [],
      sheet1Rows: officialRows,
      itemCount: officialRows.length,
      alreadyReturned,
      returnDate: text(first[1]) || undefined,
      voided: false,
      canUpdateMemo: false,
      canUpdateSheet1: true,
      source: "SHEET1",
      warning: "This is a historical SHEET1 memo. SHEET1 can be updated safely, but no exact MEMO-sheet link is available.",
    };
  }

  if (/^\d+(?:\.\d+)?$/.test(reference)) {
    const base = String(Math.floor(Number(reference)));
    const matchedMemoRows: number[] = [];
    for (let index = 1; index < memoRows.length; index += 1) {
      if (memoBase(memoRows[index]?.[0]) === base) matchedMemoRows.push(index + 1);
    }

    if (matchedMemoRows.length) {
      const first = getRow(memoRows, matchedMemoRows[0]);
      return {
        reference,
        memoNumber: base,
        recipient: text(first[3]),
        through: text(first[4]),
        memoRows: matchedMemoRows,
        sheet1Rows: [],
        itemCount: matchedMemoRows.length,
        alreadyReturned: matchedMemoRows.every((rowNumber) => text(getRow(memoRows, rowNumber)[11]).toUpperCase() === "RETURNED"),
        voided: matchedMemoRows.every((rowNumber) => text(getRow(memoRows, rowNumber)[11]).toUpperCase() === "VOID"),
        canUpdateMemo: true,
        canUpdateSheet1: false,
        source: "MEMO",
        warning: "This historical internal MEMO number has no safe SHEET1 link. Use the official SHEET1 memo number to update the return register.",
      };
    }
  }

  throw new Error(`No memorandum matching “${reference}” was found.`);
}
