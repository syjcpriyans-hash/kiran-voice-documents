import { NextResponse } from "next/server";
import { z } from "zod";
import {
  batchUpdateSpreadsheet,
  findSheet,
  getSheetValues,
  getSpreadsheetMetadata,
  quoteSheetName,
  type GoogleSheetProperties,
  type GoogleSpreadsheetMetadata,
} from "@/lib/google-sheets";

export const runtime = "nodejs";
export const maxDuration = 60;

const itemSchema = z.object({
  sourceRowId: z.string().nullable().optional(),
  sourceSerialNumber: z.string().nullable().optional(),
  size: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  carats: z.number().positive().max(1_000_000),
  askingPrice: z.number().positive().max(1_000_000_000),
  remarks: z.string().max(500).default(""),
});

const requestSchema = z.object({
  requestId: z.string().uuid(),
  recipientName: z.string().min(1).max(250),
  recipientType: z.enum(["Broker", "Customer", "Other"]),
  through: z.string().max(250).default(""),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(itemSchema).min(1).max(8),
});

type Input = z.infer<typeof requestSchema>;

type CellInput = string | number | boolean | null;

type ParsedDescription = {
  shape: string;
  quality: string;
  color: string;
};

const SYSTEM_LOG = "_SYSTEM_LOG";
const MEMO_COLUMNS = 14;
const SHEET1_COLUMNS = 16;
const LOG_COLUMNS = 11;

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeHeader(value: unknown): string {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseMemoLine(value: unknown): number | null {
  const valueText = text(value);

  if (!/^\d+(?:\.\d+)?$/.test(valueText)) return null;

  const numeric = Number(valueText);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100_000) {
    return null;
  }

  return numeric;
}

function parseDiamondDescription(value: string): ParsedDescription {
  const upper = value.trim().toUpperCase();

  const bracketMatch = upper.match(
    /\[\s*([A-Z0-9]+)\s*\]\s*\[\s*([A-Z0-9-]+)\s*\(\s*([A-Z0-9-]+)\s*\)\s*\]/,
  );

  if (bracketMatch) {
    return {
      shape: bracketMatch[1],
      quality: bracketMatch[2],
      color: bracketMatch[3],
    };
  }

  const compact = upper.replace(/[^A-Z0-9]/g, "");
  const qualityMatch = compact.match(/FL|IF|VVS[12]|VS[12]|SI[123]|I[123]/);

  if (!qualityMatch || qualityMatch.index === undefined) {
    throw new Error(
      `Description "${value}" is not in the expected format [ SHAPE ] [ QUALITY (COLOR) ].`,
    );
  }

  const shape = compact.slice(0, qualityMatch.index);
  const qualityToken = qualityMatch[0];
  const color = compact.slice(qualityMatch.index + qualityToken.length);
  const quality = qualityToken.replace(
    /(VVS|VS|SI|I)([1-3])$/,
    "$1-$2",
  );

  if (!shape || !quality || !color) {
    throw new Error(
      `Description "${value}" is missing the shape, quality or colour.`,
    );
  }

  return { shape, quality, color };
}

function dateToGoogleSerial(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  return utc / 86_400_000 + 25_569;
}

function toCellData(value: CellInput): Record<string, unknown> {
  if (typeof value === "number") {
    return { userEnteredValue: { numberValue: value } };
  }

  if (typeof value === "boolean") {
    return { userEnteredValue: { boolValue: value } };
  }

  return {
    userEnteredValue: {
      stringValue: value === null ? "" : value,
    },
  };
}

function updateCellsRequest(
  sheetId: number,
  startRow: number,
  rows: CellInput[][],
  columnCount: number,
): Record<string, unknown> {
  return {
    updateCells: {
      range: {
        sheetId,
        startRowIndex: startRow - 1,
        endRowIndex: startRow - 1 + rows.length,
        startColumnIndex: 0,
        endColumnIndex: columnCount,
      },
      rows: rows.map((row) => ({
        values: row.map(toCellData),
      })),
      fields: "userEnteredValue",
    },
  };
}

function copyRowFormatRequest(
  sheetId: number,
  sourceRow: number,
  destinationStartRow: number,
  destinationRowCount: number,
  columnCount: number,
): Record<string, unknown> | null {
  if (sourceRow < 1 || destinationRowCount < 1) return null;

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

function appendRowsIfNeeded(
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

async function ensureSystemLog(
  initialMetadata: GoogleSpreadsheetMetadata,
): Promise<{
  metadata: GoogleSpreadsheetMetadata;
  logSheet: GoogleSheetProperties;
}> {
  let metadata = initialMetadata;
  let logSheet = findSheet(metadata, SYSTEM_LOG);

  if (!logSheet) {
    await batchUpdateSpreadsheet([
      {
        addSheet: {
          properties: {
            title: SYSTEM_LOG,
            hidden: true,
            gridProperties: {
              rowCount: 1000,
              columnCount: LOG_COLUMNS,
              frozenRowCount: 1,
            },
          },
        },
      },
    ]);

    metadata = await getSpreadsheetMetadata();
    logSheet = findSheet(metadata, SYSTEM_LOG);
  }

  if (!logSheet) {
    throw new Error("The internal Google Sheet log could not be created.");
  }

  const header = await getSheetValues(
    `${quoteSheetName(SYSTEM_LOG)}!A1:K1`,
    { valueRenderOption: "FORMATTED_VALUE" },
  );

  if (!header.length || !text(header[0]?.[0])) {
    await batchUpdateSpreadsheet([
      updateCellsRequest(
        logSheet.sheetId,
        1,
        [[
          "REQUEST ID",
          "STATUS",
          "MEMO NO.",
          "MEMO ROWS",
          "SHEET1 ROWS",
          "TOTAL CARATS",
          "RECIPIENT",
          "CREATED AT",
          "SOURCE",
          "DOCUMENT JSON",
          "ERROR",
        ]],
        LOG_COLUMNS,
      ),
      {
        updateSheetProperties: {
          properties: {
            sheetId: logSheet.sheetId,
            hidden: true,
            gridProperties: {
              frozenRowCount: 1,
            },
          },
          fields: "hidden,gridProperties.frozenRowCount",
        },
      },
    ]);
  }

  return { metadata, logSheet };
}

function findExistingRequest(
  logRows: unknown[][],
  requestId: string,
) {
  for (let index = 1; index < logRows.length; index += 1) {
    const row = logRows[index] || [];
    if (text(row[0]) === requestId && text(row[1]) === "COMPLETE") {
      return {
        id: requestId,
        serial_number: text(row[2]),
        memo_number: text(row[2]),
        memo_rows: text(row[3]),
        sheet1_rows: text(row[4]),
        total_carats: Number(row[5] || 0),
        sheet_write_status: "completed" as const,
        is_new: false,
      };
    }
  }

  return null;
}

function findNextMemoPosition(values: unknown[][]): {
  nextMemoNumber: number;
  startRow: number;
  sourceFormatRow: number;
} {
  let maxMemoNumber = 0;
  let lastNumericRow = 0;

  for (let index = 0; index < values.length; index += 1) {
    const line = parseMemoLine(values[index]?.[0]);
    if (line === null) continue;

    const base = Math.floor(line);
    if (base > maxMemoNumber) maxMemoNumber = base;
    lastNumericRow = index + 1;
  }

  if (!lastNumericRow) {
    throw new Error(
      "No existing numeric memo-line code was found in MEMO column A. The workbook mapping needs review.",
    );
  }

  return {
    nextMemoNumber: maxMemoNumber + 1,
    startRow: lastNumericRow + 1,
    sourceFormatRow: lastNumericRow,
  };
}

function findSheet1Position(values: unknown[][]): {
  startRow: number;
  sourceFormatRow: number;
} {
  let headerRow = 1;

  for (let index = 0; index < Math.min(values.length, 40); index += 1) {
    const row = values[index] || [];
    const memoHeader = normalizeHeader(row[2]);
    const customerHeader = normalizeHeader(row[3]);

    if (
      memoHeader.includes("MEMO") &&
      customerHeader.includes("CUSTOMER")
    ) {
      headerRow = index + 1;
      break;
    }
  }

  let lastDataRow = headerRow;

  for (let index = headerRow; index < values.length; index += 1) {
    const row = values[index] || [];
    const sendingDate = text(row[0]);
    const memoNumber = text(row[2]);
    const customer = text(row[3]);
    const carats = row[10];

    const isMarker =
      sendingDate === "*" &&
      !memoNumber &&
      !customer &&
      !text(carats);

    const hasRealData =
      !isMarker &&
      (
        (memoNumber && memoNumber !== "*") ||
        (customer && (sendingDate || text(carats)))
      );

    if (hasRealData) lastDataRow = index + 1;
  }

  return {
    startRow: lastDataRow + 1,
    sourceFormatRow: lastDataRow,
  };
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());

    let metadata = await getSpreadsheetMetadata();
    const ensured = await ensureSystemLog(metadata);
    metadata = ensured.metadata;

    const memoSheet = findSheet(metadata, "MEMO");
    const sheet1 = findSheet(metadata, "SHEET1");
    const logSheet = ensured.logSheet;

    if (!memoSheet || !sheet1) {
      throw new Error(
        "The Google Sheet must contain worksheets named MEMO and SHEET1.",
      );
    }

    const [memoColumnA, sheet1Rows, logRows] = await Promise.all([
      getSheetValues(`${quoteSheetName("MEMO")}!A:A`, {
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
      getSheetValues(`${quoteSheetName("SHEET1")}!A1:P2000`, {
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
      getSheetValues(`${quoteSheetName(SYSTEM_LOG)}!A:K`, {
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
    ]);

    const existing = findExistingRequest(logRows, input.requestId);
    if (existing) {
      return NextResponse.json({ document: existing });
    }

    const memoPosition = findNextMemoPosition(memoColumnA);
    const sheet1Position = findSheet1Position(sheet1Rows);
    const logStartRow = Math.max(logRows.length + 1, 2);
    const parsedItems = input.items.map((item) => ({
      ...item,
      parsed: parseDiamondDescription(item.description),
    }));

    const memoNumber = memoPosition.nextMemoNumber;
    const dateSerial = dateToGoogleSerial(input.documentDate);
    const recipientForMemo =
      input.recipientType === "Other"
        ? input.recipientName
        : `${input.recipientName} (${input.recipientType})`;
    const totalCarats = Number(
      input.items.reduce((sum, item) => sum + item.carats, 0).toFixed(2),
    );

    const memoRows: CellInput[][] = parsedItems.map((item, index) => {
      const repeatPrice =
        index > 0 &&
        parsedItems[index - 1].askingPrice === item.askingPrice;

      return [
        Number(`${memoNumber}.${index + 1}`),
        dateSerial,
        "",
        recipientForMemo,
        input.through,
        item.parsed.shape,
        item.size,
        `${item.parsed.quality} (${item.parsed.color})`,
        item.carats,
        repeatPrice ? '"' : item.askingPrice,
        item.remarks,
        "",
        "",
        "",
      ];
    });

    const sheet1WriteRows: CellInput[][] = parsedItems.map((item) => [
      dateSerial,
      "",
      memoNumber,
      input.recipientName,
      input.through,
      "",
      item.parsed.shape,
      item.size,
      item.parsed.color,
      item.parsed.quality,
      item.carats,
      item.askingPrice,
      item.remarks,
      "",
      "",
      "",
    ]);

    const memoEndRow = memoPosition.startRow + memoRows.length - 1;
    const sheet1EndRow =
      sheet1Position.startRow + sheet1WriteRows.length - 1;
    const memoRowLabel = `${memoPosition.startRow}:${memoEndRow}`;
    const sheet1RowLabel = `${sheet1Position.startRow}:${sheet1EndRow}`;

    const logRow: CellInput[][] = [[
      input.requestId,
      "COMPLETE",
      String(memoNumber),
      memoRowLabel,
      sheet1RowLabel,
      totalCarats,
      input.recipientName,
      new Date().toISOString(),
      "KIRAN VOICE DOCUMENTS",
      JSON.stringify(input),
      "",
    ]];

    const requests: Record<string, unknown>[] = [];

    for (const expansion of [
      appendRowsIfNeeded(memoSheet, memoEndRow),
      appendRowsIfNeeded(sheet1, sheet1EndRow),
      appendRowsIfNeeded(logSheet, logStartRow),
    ]) {
      if (expansion) requests.push(expansion);
    }

    for (const formatCopy of [
      copyRowFormatRequest(
        memoSheet.sheetId,
        memoPosition.sourceFormatRow,
        memoPosition.startRow,
        memoRows.length,
        MEMO_COLUMNS,
      ),
      copyRowFormatRequest(
        sheet1.sheetId,
        sheet1Position.sourceFormatRow,
        sheet1Position.startRow,
        sheet1WriteRows.length,
        SHEET1_COLUMNS,
      ),
    ]) {
      if (formatCopy) requests.push(formatCopy);
    }

    requests.push(
      updateCellsRequest(
        memoSheet.sheetId,
        memoPosition.startRow,
        memoRows,
        MEMO_COLUMNS,
      ),
      updateCellsRequest(
        sheet1.sheetId,
        sheet1Position.startRow,
        sheet1WriteRows,
        SHEET1_COLUMNS,
      ),
      updateCellsRequest(
        logSheet.sheetId,
        logStartRow,
        logRow,
        LOG_COLUMNS,
      ),
    );

    await batchUpdateSpreadsheet(requests);

    return NextResponse.json({
      document: {
        id: input.requestId,
        serial_number: String(memoNumber),
        memo_number: String(memoNumber),
        total_carats: totalCarats,
        sheet_write_status: "completed",
        memo_rows: memoRowLabel,
        sheet1_rows: sheet1RowLabel,
        is_new: true,
      },
    });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json(
        {
          error:
            cause.issues[0]?.message || "The document data is incomplete.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "Google Sheet recording failed.",
      },
      { status: 500 },
    );
  }
}
