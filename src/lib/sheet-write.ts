export type CellInput = string | number | boolean | null;

export function dateToGoogleSerial(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  return utc / 86_400_000 + 25_569;
}

function toCellData(value: CellInput): Record<string, unknown> {
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: value === null ? "" : value } };
}

export function updateRangeRequest(
  sheetId: number,
  startRow: number,
  startColumnIndex: number,
  rows: CellInput[][],
): Record<string, unknown> {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  return {
    updateCells: {
      range: {
        sheetId,
        startRowIndex: startRow - 1,
        endRowIndex: startRow - 1 + rows.length,
        startColumnIndex,
        endColumnIndex: startColumnIndex + columnCount,
      },
      rows: rows.map((row) => ({ values: row.map(toCellData) })),
      fields: "userEnteredValue",
    },
  };
}

export function numberFormatRequest(
  sheetId: number,
  startRow: number,
  rowCount: number,
  columnIndex: number,
  type: "DATE" | "NUMBER" | "TIME",
  pattern: string,
): Record<string, unknown> {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: startRow - 1,
        endRowIndex: startRow - 1 + rowCount,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      cell: { userEnteredFormat: { numberFormat: { type, pattern } } },
      fields: "userEnteredFormat.numberFormat",
    },
  };
}

export function groupContiguousRows(rows: number[]): Array<{ start: number; end: number }> {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const groups: Array<{ start: number; end: number }> = [];

  for (const row of sorted) {
    const last = groups.at(-1);
    if (last && row === last.end + 1) last.end = row;
    else groups.push({ start: row, end: row });
  }

  return groups;
}
