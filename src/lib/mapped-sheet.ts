import {
  getSpreadsheetMetadata,
  getSheetValues,
  quoteSheetName,
  type GoogleSheetProperties,
  type GoogleSpreadsheetMetadata,
} from "@/lib/google-sheets";
import {
  getActiveSheetConnection,
  resolveRoleSheet,
  type MemoColumns,
  type SheetConnectionConfig,
  type TrackingColumns,
} from "@/lib/sheet-connection";
import { updateRangeRequest, type CellInput } from "@/lib/sheet-write";

export function sheetText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function mappedCell(
  row: unknown[],
  column: number | undefined,
): string {
  if (!Number.isInteger(column)) return "";
  return sheetText(row[column as number]);
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function verifyRoleHeader(
  sheet: GoogleSheetProperties,
  role: {
    headerRow: number;
    columns: Record<string, number | undefined>;
    headerLabels?: Record<string, string>;
  },
  label: string,
) {
  const expected = role.headerLabels || {};
  if (!Object.keys(expected).length) return;

  const lastColumn = lastMappedColumnLetter(role.columns);
  const rows = await getSheetValues(
    `${quoteSheetName(sheet.title)}!A${role.headerRow}:${lastColumn}${role.headerRow}`,
    { valueRenderOption: "FORMATTED_VALUE" },
  );
  const header = rows[0] || [];

  for (const [field, expectedLabel] of Object.entries(expected)) {
    const column = role.columns[field];
    if (!Number.isInteger(column)) continue;
    const actualLabel = sheetText(header[column as number]);
    if (normalizeHeader(actualLabel) !== normalizeHeader(expectedLabel)) {
      throw new Error(
        `${label} structure changed at “${expectedLabel}”. Recheck the Google Sheet connection before recording transactions.`,
      );
    }
  }
}

export async function resolveConnectedSheets(): Promise<{
  config: SheetConnectionConfig;
  mode: "oauth" | "legacy";
  metadata: GoogleSpreadsheetMetadata;
  memo: GoogleSheetProperties;
  tracking: GoogleSheetProperties;
  master: GoogleSheetProperties | null;
}> {
  const active = await getActiveSheetConnection();
  const metadata = await getSpreadsheetMetadata();

  const memo = resolveRoleSheet(metadata, active.config.memo);
  const tracking = resolveRoleSheet(metadata, active.config.tracking);
  const master = active.config.master
    ? resolveRoleSheet(metadata, active.config.master)
    : null;

  if (!memo || !tracking) {
    throw new Error(
      "The connected Google Sheet changed and its saved worksheet mapping is no longer valid. Reconnect the Google Sheet.",
    );
  }

  await Promise.all([
    verifyRoleHeader(memo, active.config.memo, "Memorandum worksheet"),
    verifyRoleHeader(
      tracking,
      active.config.tracking,
      "Tracking worksheet",
    ),
    master && active.config.master
      ? verifyRoleHeader(master, active.config.master, "Master-data worksheet")
      : Promise.resolve(),
  ]);

  return {
    config: active.config,
    mode: active.mode,
    metadata,
    memo,
    tracking,
    master,
  };
}

export function findNextMemoPosition(
  values: unknown[][],
  headerRow: number,
  memoLineColumn: number,
): {
  nextMemoNumber: number;
  startRow: number;
  sourceFormatRow: number;
} {
  let maxMemoNumber = 0;
  let lastNumericRow = 0;

  for (let index = Math.max(0, headerRow); index < values.length; index += 1) {
    const raw = sheetText(values[index]?.[memoLineColumn]);
    const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
    if (!match) continue;

    const base = Number(match[1]);
    if (!Number.isFinite(base)) continue;
    if (base > maxMemoNumber) maxMemoNumber = base;
    lastNumericRow = index + 1;
  }

  if (!lastNumericRow) {
    throw new Error(
      "No existing numeric memorandum line number was found in the connected memorandum worksheet. Review the Google Sheet mapping.",
    );
  }

  return {
    nextMemoNumber: maxMemoNumber + 1,
    startRow: lastNumericRow + 1,
    sourceFormatRow: lastNumericRow,
  };
}

export function findAppendPosition(
  values: unknown[][],
  headerRow: number,
  keyColumns: number[],
): {
  startRow: number;
  sourceFormatRow: number;
} {
  let markerRow = values.length + 1;

  for (let index = Math.max(0, headerRow); index < values.length; index += 1) {
    const row = values[index] || [];
    const cells = keyColumns
      .filter(Number.isInteger)
      .map((column) => sheetText(row[column]));
    const starCount = cells.filter((value) => value === "*").length;
    const realValues = cells.filter((value) => value && value !== "*");
    const normalizedValues = realValues.map((value) =>
      value
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .trim(),
    );
    const summaryMarker = normalizedValues.some((value) =>
      ["TOTAL", "TOTALS", "GRAND TOTAL", "SUMMARY", "SUBTOTAL"].includes(
        value,
      ),
    );

    if (
      summaryMarker ||
      (starCount >= Math.min(4, Math.max(2, keyColumns.length / 2)) &&
        !realValues.length)
    ) {
      markerRow = index + 1;
      break;
    }
  }

  let lastDataRow = headerRow;
  const lastSearchIndex = Math.min(values.length, markerRow - 1);

  for (
    let index = Math.max(0, headerRow);
    index < lastSearchIndex;
    index += 1
  ) {
    const row = values[index] || [];
    const hasRealData = keyColumns.some((column) => {
      const value = sheetText(row[column]);
      return Boolean(value && value !== "*");
    });

    if (hasRealData) lastDataRow = index + 1;
  }

  return {
    startRow: Math.max(headerRow + 1, lastDataRow + 1),
    sourceFormatRow: Math.max(headerRow + 1, lastDataRow),
  };
}

export function copyRowFormatRequest(
  sheetId: number,
  sourceRow: number,
  destinationStartRow: number,
  destinationRowCount: number,
  columnCount: number,
): Record<string, unknown> | null {
  if (sourceRow < 1 || destinationRowCount < 1 || columnCount < 1) return null;

  return {
    copyPaste: {
      source: {
        sheetId,
        startRowIndex: sourceRow - 1,
        endRowIndex: sourceRow,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      destination: {
        sheetId,
        startRowIndex: destinationStartRow - 1,
        endRowIndex: destinationStartRow - 1 + destinationRowCount,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      pasteType: "PASTE_FORMAT",
      pasteOrientation: "NORMAL",
    },
  };
}

export function appendRowsIfNeeded(
  sheet: GoogleSheetProperties,
  neededLastRow: number,
): Record<string, unknown> | null {
  const currentRows = sheet.gridProperties?.rowCount || 0;
  if (neededLastRow <= currentRows) return null;

  return {
    appendDimension: {
      sheetId: sheet.sheetId,
      dimension: "ROWS",
      length: neededLastRow - currentRows + 50,
    },
  };
}

export function writeColumn(
  requests: Record<string, unknown>[],
  sheetId: number,
  startRow: number,
  column: number | undefined,
  values: CellInput[],
) {
  if (!Number.isInteger(column) || !values.length) return;
  requests.push(
    updateRangeRequest(
      sheetId,
      startRow,
      column as number,
      values.map((value) => [value]),
    ),
  );
}

export function memoKeyColumns(columns: MemoColumns): number[] {
  return [
    columns.memoLine,
    columns.date,
    columns.recipient,
    columns.shape,
    columns.size,
    columns.quality,
    columns.carats,
    columns.askingPrice,
  ];
}

export function trackingKeyColumns(columns: TrackingColumns): number[] {
  return [
    columns.sentDate,
    columns.returnDate,
    columns.memoNumber,
    columns.customer,
    columns.shape,
    columns.size,
    columns.quality,
    columns.carats,
    columns.askingPrice,
  ].filter((value): value is number => Number.isInteger(value));
}

export function lastMappedColumnLetter(
  columns: Record<string, number | undefined>,
  minimumColumnIndex = 0,
): string {
  const highest = Math.max(
    minimumColumnIndex,
    ...Object.values(columns).filter(
      (value): value is number => Number.isInteger(value) && Number(value) >= 0,
    ),
  );

  let value = highest + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}
