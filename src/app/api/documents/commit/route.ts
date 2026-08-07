import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import {
  batchUpdateSpreadsheet,
  findSheet,
  getSheetValues,
  getSpreadsheetMetadata,
  quoteSheetName,
  type GoogleSheetProperties,
  type GoogleSpreadsheetMetadata,
} from "@/lib/google-sheets";
import { loadMasterData, normalizeBusinessText } from "@/lib/master-data";
import {
  appendRowsIfNeeded,
  copyRowFormatRequest,
  findAppendPosition,
  findNextMemoPosition,
  resolveConnectedSheets,
  trackingKeyColumns,
  lastMappedColumnLetter,
  writeColumn,
} from "@/lib/mapped-sheet";
import { SYSTEM_LOG_SHEET } from "@/lib/sheet-connection";
import {
  dateToGoogleSerial,
  numberFormatRequest,
  updateRangeRequest,
  type CellInput,
} from "@/lib/sheet-write";

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

type ParsedDescription = {
  shape: string;
  quality: string;
  color: string;
};

type InputItem = {
  sourceRowId?: string | null;
  sourceSerialNumber?: string | null;
  size: string;
  description: string;
  carats: number;
  askingPrice: number;
  remarks: string;
};

type Input = {
  requestId: string;
  recipientName: string;
  recipientType: "Broker" | "Customer" | "Other";
  through: string;
  documentDate: string;
  items: InputItem[];
};

type ParsedItem = InputItem & {
  parsed: ParsedDescription;
};

const LOG_COLUMNS = 19;

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseDiamondDescription(value: string): ParsedDescription {
  const upper = value.trim().toUpperCase();

  const bracketMatch = upper.match(
    /^\[\s*([^\]]+)\s*\]\s*\[\s*([^\]]+)\s*\]$/,
  );

  if (bracketMatch) {
    const shape = bracketMatch[1].trim();
    const second = bracketMatch[2].trim();
    const qualityColor = second.match(/^(.+?)\s*\(\s*([^\)]+)\s*\)$/);
    return {
      shape,
      quality: qualityColor ? qualityColor[1].trim() : second,
      color: qualityColor ? qualityColor[2].trim() : "",
    };
  }

  const compact = upper.replace(/[^A-Z0-9]/g, "");
  const qualityMatch = compact.match(/FL|IF|VVS[12]|VS[12]|SI[123]|I[123]/);

  if (!qualityMatch || qualityMatch.index === undefined) {
    throw new Error(
      `Description "${value}" is not in the expected format [ SHAPE ] [ QUALITY ].`,
    );
  }

  const shape = compact.slice(0, qualityMatch.index);
  const qualityToken = qualityMatch[0];
  const color = compact.slice(qualityMatch.index + qualityToken.length);
  const quality = qualityToken.replace(
    /(VVS|VS|SI|I)([1-3])$/,
    "$1-$2",
  );

  if (!shape || !quality) {
    throw new Error(`Description "${value}" is missing the shape or quality.`);
  }

  return { shape, quality, color };
}

async function ensureSystemLog(
  initialMetadata: GoogleSpreadsheetMetadata,
): Promise<{
  metadata: GoogleSpreadsheetMetadata;
  logSheet: GoogleSheetProperties;
}> {
  let metadata = initialMetadata;
  let logSheet = findSheet(metadata, SYSTEM_LOG_SHEET);

  if (!logSheet) {
    await batchUpdateSpreadsheet([
      {
        addSheet: {
          properties: {
            title: SYSTEM_LOG_SHEET,
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
    logSheet = findSheet(metadata, SYSTEM_LOG_SHEET);
  }

  if (!logSheet) {
    throw new Error("The internal Google Sheet log could not be created.");
  }

  const currentColumns = logSheet.gridProperties?.columnCount || 0;
  if (currentColumns < LOG_COLUMNS) {
    await batchUpdateSpreadsheet([
      {
        appendDimension: {
          sheetId: logSheet.sheetId,
          dimension: "COLUMNS",
          length: LOG_COLUMNS - currentColumns,
        },
      },
    ]);
    metadata = await getSpreadsheetMetadata();
    logSheet = findSheet(metadata, SYSTEM_LOG_SHEET);
    if (!logSheet) {
      throw new Error("The internal Google Sheet log could not be expanded.");
    }
  }

  const header = await getSheetValues(
    `${quoteSheetName(SYSTEM_LOG_SHEET)}!A1:S1`,
    { valueRenderOption: "FORMATTED_VALUE" },
  );

  if (
    !header.length ||
    !text(header[0]?.[0]) ||
    text(header[0]?.[15]) !== "VOID STATUS"
  ) {
    await batchUpdateSpreadsheet([
      updateRangeRequest(logSheet.sheetId, 1, 0, [[
        "REQUEST ID",
        "STATUS",
        "MEMO NO.",
        "MEMO ROWS",
        "TRACKING ROWS",
        "TOTAL CARATS",
        "RECIPIENT",
        "CREATED AT",
        "SOURCE",
        "DOCUMENT JSON",
        "ERROR",
        "RETURN STATUS",
        "RETURNED AT",
        "CONFIRM PERSON",
        "RETURN REQUEST ID",
        "VOID STATUS",
        "VOIDED AT",
        "VOID REASON",
        "VOID REQUEST ID",
      ]]),
      {
        updateSheetProperties: {
          properties: {
            sheetId: logSheet.sheetId,
            hidden: true,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: "hidden,gridProperties.frozenRowCount",
        },
      },
    ]);
  }

  return { metadata, logSheet };
}

function findExistingRequest(logRows: unknown[][], requestId: string) {
  for (let index = 1; index < logRows.length; index += 1) {
    const row = logRows[index] || [];
    if (
      text(row[0]) === requestId &&
      ["COMPLETE", "VOID"].includes(text(row[1]))
    ) {
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

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json()) as Input;
    const connected = await resolveConnectedSheets();
    const memoColumns = connected.config.memo.columns;
    const trackingColumns = connected.config.tracking.columns;

    const master = await loadMasterData();
    const knownSizes = new Set(master.sizes.map(normalizeBusinessText));
    const knownShapes = new Set(master.shapes.map(normalizeBusinessText));
    const knownQualities = new Set(
      master.qualities.map(normalizeBusinessText),
    );

    input.items.forEach((item, index) => {
      const parsed = parseDiamondDescription(item.description);
      const combinedQuality = parsed.color
        ? `${parsed.quality} (${parsed.color})`
        : parsed.quality;

      if (
        knownSizes.size &&
        !knownSizes.has(normalizeBusinessText(item.size))
      ) {
        throw new Error(
          `Row ${index + 1}: size “${item.size}” is not present in the connected terminology.`,
        );
      }
      if (
        knownShapes.size &&
        !knownShapes.has(normalizeBusinessText(parsed.shape))
      ) {
        throw new Error(
          `Row ${index + 1}: shape “${parsed.shape}” is not present in the connected terminology.`,
        );
      }
      if (
        knownQualities.size &&
        !knownQualities.has(normalizeBusinessText(combinedQuality))
      ) {
        throw new Error(
          `Row ${index + 1}: quality or colour “${combinedQuality}” is not present in the connected terminology.`,
        );
      }
    });

    const ensured = await ensureSystemLog(connected.metadata);
    const logSheet = ensured.logSheet;
    const memoLastColumn = lastMappedColumnLetter(memoColumns);
    const trackingLastColumn = lastMappedColumnLetter(trackingColumns);

    const [memoRows, trackingRows, logRows] = await Promise.all([
      getSheetValues(
        `${quoteSheetName(connected.memo.title)}!A1:${memoLastColumn}20000`,
        { valueRenderOption: "UNFORMATTED_VALUE" },
      ),
      getSheetValues(
        `${quoteSheetName(connected.tracking.title)}!A1:${trackingLastColumn}10000`,
        { valueRenderOption: "UNFORMATTED_VALUE" },
      ),
      getSheetValues(`${quoteSheetName(SYSTEM_LOG_SHEET)}!A1:S10000`, {
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
    ]);

    const existing = findExistingRequest(logRows, input.requestId);
    if (existing) {
      return NextResponse.json({ document: existing });
    }

    const memoPosition = findNextMemoPosition(
      memoRows,
      connected.config.memo.headerRow,
      memoColumns.memoLine,
    );
    const trackingPosition = findAppendPosition(
      trackingRows,
      connected.config.tracking.headerRow,
      trackingKeyColumns(trackingColumns),
    );

    const parsedItems: ParsedItem[] = input.items.map((item) => ({
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

    const itemCount = parsedItems.length;
    const memoEndRow = memoPosition.startRow + itemCount - 1;
    const trackingEndRow = trackingPosition.startRow + itemCount - 1;
    const memoRowLabel = `${memoPosition.startRow}:${memoEndRow}`;
    const trackingRowLabel = `${trackingPosition.startRow}:${trackingEndRow}`;
    const logStartRow = Math.max(logRows.length + 1, 2);

    const requests: Record<string, unknown>[] = [];

    for (const expansion of [
      appendRowsIfNeeded(connected.memo, memoEndRow),
      appendRowsIfNeeded(connected.tracking, trackingEndRow),
      appendRowsIfNeeded(logSheet, logStartRow),
    ]) {
      if (expansion) requests.push(expansion);
    }

    for (const formatCopy of [
      copyRowFormatRequest(
        connected.memo.sheetId,
        memoPosition.sourceFormatRow,
        memoPosition.startRow,
        itemCount,
        Math.min(connected.memo.gridProperties?.columnCount || 52, 52),
      ),
      copyRowFormatRequest(
        connected.tracking.sheetId,
        trackingPosition.sourceFormatRow,
        trackingPosition.startRow,
        itemCount,
        Math.min(connected.tracking.gridProperties?.columnCount || 52, 52),
      ),
    ]) {
      if (formatCopy) requests.push(formatCopy);
    }

    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.memoLine,
      parsedItems.map((_, index) => Number(`${memoNumber}.${index + 1}`)),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.date,
      parsedItems.map(() => dateSerial),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.recipient,
      parsedItems.map(() => recipientForMemo),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.through,
      parsedItems.map(() => input.through),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.shape,
      parsedItems.map((item) => item.parsed.shape),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.size,
      parsedItems.map((item) => item.size),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.quality,
      parsedItems.map((item) =>
        Number.isInteger(memoColumns.color) || !item.parsed.color
          ? item.parsed.quality
          : `${item.parsed.quality} (${item.parsed.color})`,
      ),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.color,
      parsedItems.map((item) => item.parsed.color),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.carats,
      parsedItems.map((item) => item.carats),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.askingPrice,
      parsedItems.map((item, index) =>
        index > 0 &&
        parsedItems[index - 1].askingPrice === item.askingPrice
          ? '"'
          : item.askingPrice,
      ),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.remarks,
      parsedItems.map((item) => item.remarks),
    );
    writeColumn(
      requests,
      connected.memo.sheetId,
      memoPosition.startRow,
      memoColumns.status,
      parsedItems.map(() => ""),
    );

    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.sentDate,
      parsedItems.map(() => dateSerial),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.returnDate,
      parsedItems.map(() => ""),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.memoNumber,
      parsedItems.map(() => ""),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.customer,
      parsedItems.map(() => input.recipientName),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.through,
      parsedItems.map(() => input.through),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.shape,
      parsedItems.map((item) => item.parsed.shape),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.size,
      parsedItems.map((item) => item.size),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.color,
      parsedItems.map((item) => item.parsed.color),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.quality,
      parsedItems.map((item) =>
        Number.isInteger(trackingColumns.color) || !item.parsed.color
          ? item.parsed.quality
          : `${item.parsed.quality} (${item.parsed.color})`,
      ),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.carats,
      parsedItems.map((item) => item.carats),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.askingPrice,
      parsedItems.map((item) => item.askingPrice),
    );
    writeColumn(
      requests,
      connected.tracking.sheetId,
      trackingPosition.startRow,
      trackingColumns.remarks,
      parsedItems.map((item) => item.remarks),
    );

    const logRow: CellInput[][] = [[
      input.requestId,
      "COMPLETE",
      String(memoNumber),
      memoRowLabel,
      trackingRowLabel,
      totalCarats,
      input.recipientName,
      new Date().toISOString(),
      "KIRAN ASSISTANT",
      JSON.stringify(input),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]];

    requests.push(
      updateRangeRequest(logSheet.sheetId, logStartRow, 0, logRow),
      numberFormatRequest(
        connected.memo.sheetId,
        memoPosition.startRow,
        itemCount,
        memoColumns.date,
        "DATE",
        "dd-mmm-yy",
      ),
      numberFormatRequest(
        connected.tracking.sheetId,
        trackingPosition.startRow,
        itemCount,
        trackingColumns.sentDate,
        "DATE",
        "dd-mmm-yy",
      ),
      numberFormatRequest(
        connected.memo.sheetId,
        memoPosition.startRow,
        itemCount,
        memoColumns.carats,
        "NUMBER",
        "0.00",
      ),
      numberFormatRequest(
        connected.tracking.sheetId,
        trackingPosition.startRow,
        itemCount,
        trackingColumns.carats,
        "NUMBER",
        "0.00",
      ),
      numberFormatRequest(
        connected.tracking.sheetId,
        trackingPosition.startRow,
        itemCount,
        trackingColumns.askingPrice,
        "NUMBER",
        "#,##0.00",
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
        sheet1_rows: trackingRowLabel,
        is_new: true,
      },
    });
  } catch (cause) {
    if (cause instanceof ZodError) {
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
