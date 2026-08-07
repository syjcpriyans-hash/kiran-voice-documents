import { cookies } from "next/headers";
import { unsealJson } from "@/lib/connection-crypto";

export const SHEET_CONNECTION_COOKIE = "kiran_sheet_connection";
export const SYSTEM_LOG_SHEET = "_SYSTEM_LOG";

export type MemoColumns = {
  memoLine: number;
  date: number;
  recipient: number;
  through?: number;
  shape: number;
  size: number;
  quality: number;
  color?: number;
  carats: number;
  askingPrice: number;
  remarks?: number;
  status?: number;
};

export type TrackingColumns = {
  sentDate: number;
  returnDate: number;
  memoNumber?: number;
  customer: number;
  through?: number;
  shape: number;
  size: number;
  color?: number;
  quality: number;
  carats: number;
  askingPrice: number;
  remarks?: number;
  confirmPerson?: number;
  confirmDate?: number;
  confirmTime?: number;
};

export type MasterColumns = {
  broker?: number;
  party?: number;
  operator?: number;
};

export type RoleConfig<TColumns> = {
  sheetId: number;
  sheetName: string;
  headerRow: number;
  columns: TColumns;
  headerLabels?: Record<string, string>;
};

export type SheetConnectionConfig = {
  version: 1;
  spreadsheetId: string;
  spreadsheetTitle: string;
  connectedAt: string;
  memo: RoleConfig<MemoColumns>;
  tracking: RoleConfig<TrackingColumns>;
  master?: RoleConfig<MasterColumns>;
};

export type HeaderOption = {
  index: number;
  label: string;
};

export type RoleDetection = {
  headerRow: number;
  score: number;
  headers: HeaderOption[];
  columns: Record<string, number>;
  fieldScores: Record<string, number>;
};

export type HeaderRowCandidate = {
  row: number;
  headers: HeaderOption[];
};

export type InspectedSheet = {
  sheetId: number;
  title: string;
  hidden: boolean;
  headerRows: HeaderRowCandidate[];
  memo: RoleDetection;
  tracking: RoleDetection;
  master: RoleDetection;
};

export type SheetInspection = {
  spreadsheetId: string;
  spreadsheetTitle: string;
  canEdit: boolean;
  sheets: InspectedSheet[];
  proposed?: SheetConnectionConfig;
  ready: boolean;
  warnings: string[];
};

export type GoogleSpreadsheetMetadata = {
  spreadsheetId: string;
  properties?: { title?: string };
  sheets?: Array<{
    properties: {
      sheetId: number;
      title: string;
      hidden?: boolean;
      gridProperties?: {
        rowCount?: number;
        columnCount?: number;
      };
    };
  }>;
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

type FieldDefinition = {
  aliases: string[];
  required?: boolean;
};

const MEMO_FIELDS: Record<keyof MemoColumns, FieldDefinition> = {
  memoLine: {
    aliases: [
      "MEMO LINE",
      "MEMO SR NO",
      "MEMO SERIAL",
      "SR NO",
      "SERIAL NO",
      "SERIAL NUMBER",
      "LINE NO",
    ],
    required: true,
  },
  date: {
    aliases: ["MEMO DATE", "DATE", "SENDING DATE", "SEND DATE"],
    required: true,
  },
  recipient: {
    aliases: ["RECIPIENT", "CUSTOMER", "PARTY", "TO", "CUSTOMER NAME", "PARTY NAME"],
    required: true,
  },
  through: { aliases: ["THROUGH", "BROKER", "VIA", "THRU"] },
  shape: { aliases: ["SHAPE", "CUT", "SHAPE CUT"], required: true },
  size: { aliases: ["SIZE", "DIAMOND SIZE"], required: true },
  quality: {
    aliases: ["QUALITY", "CLARITY", "QUALITY COLOUR", "QUALITY COLOR"],
    required: true,
  },
  color: { aliases: ["COLOUR", "COLOR", "COL"] },
  carats: {
    aliases: ["CARATS", "CARAT", "CTS", "WEIGHT", "CARAT WEIGHT"],
    required: true,
  },
  askingPrice: {
    aliases: ["ASKING PRICE", "ASKING RATE", "PRICE", "RATE", "ASK PRICE"],
    required: true,
  },
  remarks: { aliases: ["REMARKS", "REMARK", "NOTES", "NOTE"] },
  status: {
    aliases: ["STATUS", "RETURN STATUS", "MEMO STATUS", "CURRENT STATUS"],
  },
};

const TRACKING_FIELDS: Record<keyof TrackingColumns, FieldDefinition> = {
  sentDate: {
    aliases: ["SENDING DATE", "SEND DATE", "MEMO DATE", "DATE", "ISSUE DATE"],
    required: true,
  },
  returnDate: {
    aliases: ["RETURN DATE", "RECEIVED DATE", "RECEIPT DATE", "BACK DATE"],
    required: true,
  },
  memoNumber: {
    aliases: ["MEMO NO", "MEMO NUMBER", "MEMORANDUM NO", "REFERENCE", "REF NO"],
  },
  customer: {
    aliases: ["CUSTOMER", "PARTY", "RECIPIENT", "CUSTOMER NAME", "PARTY NAME", "TO"],
    required: true,
  },
  through: { aliases: ["THROUGH", "BROKER", "VIA", "THRU"] },
  shape: { aliases: ["SHAPE", "CUT", "SHAPE CUT"], required: true },
  size: { aliases: ["SIZE", "DIAMOND SIZE"], required: true },
  color: { aliases: ["COLOUR", "COLOR", "COL"] },
  quality: {
    aliases: ["QUALITY", "CLARITY", "QUALITY COLOUR", "QUALITY COLOR"],
    required: true,
  },
  carats: {
    aliases: ["CARATS", "CARAT", "CTS", "WEIGHT", "CARAT WEIGHT"],
    required: true,
  },
  askingPrice: {
    aliases: ["ASKING PRICE", "ASKING RATE", "PRICE", "RATE", "ASK PRICE"],
    required: true,
  },
  remarks: { aliases: ["REMARKS", "REMARK", "NOTES", "NOTE"] },
  confirmPerson: {
    aliases: ["CONFIRM PERSON", "CONFIRMED BY", "RECEIVED BY", "CONFIRM BY"],
  },
  confirmDate: {
    aliases: ["CONFIRM DATE", "CONFIRMED DATE", "RECEIVED CONFIRM DATE"],
  },
  confirmTime: {
    aliases: ["CONFIRM TIME", "CONFIRMED TIME", "RECEIVED CONFIRM TIME"],
  },
};

const MASTER_FIELDS: Record<keyof MasterColumns, FieldDefinition> = {
  broker: {
    aliases: ["BROKER", "BROKER NAME", "THROUGH", "BROKERS"],
  },
  party: {
    aliases: ["PARTY", "PARTY NAME", "CUSTOMER", "CUSTOMER NAME", "CLIENT"],
  },
  operator: {
    aliases: ["OPERATOR", "CONFIRM PERSON", "CONFIRMED BY", "STAFF", "EMPLOYEE"],
  },
};

function aliasScore(header: string, alias: string): number {
  const a = normalize(header);
  const b = normalize(alias);
  if (!a || !b) return 0;
  if (a === b) return 10;
  if (a.startsWith(`${b} `) || a.endsWith(` ${b}`)) return 8;
  if (a.includes(b) || b.includes(a)) return 6;
  return 0;
}

function detectColumns(
  headers: unknown[],
  definitions: Record<string, FieldDefinition>,
): {
  columns: Record<string, number>;
  fieldScores: Record<string, number>;
  score: number;
} {
  const used = new Set<number>();
  const columns: Record<string, number> = {};
  const fieldScores: Record<string, number> = {};
  let score = 0;

  const entries = Object.entries(definitions).sort(
    (left, right) => Number(Boolean(right[1].required)) - Number(Boolean(left[1].required)),
  );

  for (const [field, definition] of entries) {
    let bestColumn = -1;
    let bestScore = 0;

    for (let column = 0; column < headers.length; column += 1) {
      if (used.has(column)) continue;
      for (const alias of definition.aliases) {
        const current = aliasScore(String(headers[column] ?? ""), alias);
        if (current > bestScore) {
          bestScore = current;
          bestColumn = column;
        }
      }
    }

    if (bestColumn >= 0 && bestScore >= 6) {
      columns[field] = bestColumn;
      fieldScores[field] = bestScore;
      used.add(bestColumn);
      score += bestScore + (definition.required ? 8 : 2);
    }
  }

  return { columns, fieldScores, score };
}

function bestRoleDetection(
  rows: unknown[][],
  definitions: Record<string, FieldDefinition>,
): RoleDetection {
  let best: RoleDetection = {
    headerRow: 1,
    score: 0,
    headers: [],
    columns: {},
    fieldScores: {},
  };

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 40); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const detected = detectColumns(row, definitions);
    const headers = row
      .map((value, index) => ({
        index,
        label: String(value ?? "").trim(),
      }))
      .filter((item) => item.label);

    if (detected.score > best.score) {
      best = {
        headerRow: rowIndex + 1,
        score: detected.score,
        headers,
        columns: detected.columns,
        fieldScores: detected.fieldScores,
      };
    }
  }

  return best;
}

function hasRequired(
  columns: Record<string, number>,
  definitions: Record<string, FieldDefinition>,
): boolean {
  return Object.entries(definitions)
    .filter(([, definition]) => definition.required)
    .every(([field]) => Number.isInteger(columns[field]));
}

function hasStrongRequired(
  detection: RoleDetection,
  definitions: Record<string, FieldDefinition>,
): boolean {
  return Object.entries(definitions)
    .filter(([, definition]) => definition.required)
    .every(
      ([field]) =>
        Number.isInteger(detection.columns[field]) &&
        (detection.fieldScores[field] || 0) >= 8,
    );
}

function spreadsheetColumnLabel(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function headerRowCandidates(rows: unknown[][]): HeaderRowCandidate[] {
  const candidates: HeaderRowCandidate[] = [];

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 40); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const nonEmptyIndexes = row
      .map((value, index) => ({ index, value: String(value ?? "").trim() }))
      .filter((item) => item.value && item.value !== "*")
      .map((item) => item.index);

    if (nonEmptyIndexes.length < 2) continue;

    const lastColumn = Math.max(...nonEmptyIndexes);
    const headers = Array.from({ length: lastColumn + 1 }, (_, index) => {
      const label = String(row[index] ?? "").trim();
      return {
        index,
        label:
          label && label !== "*"
            ? label
            : `Column ${spreadsheetColumnLabel(index)} (blank heading)`,
      };
    });

    candidates.push({ row: rowIndex + 1, headers });
  }

  return candidates;
}

function inferMemoLineColumn(
  rows: unknown[][],
  headerRow: number,
): { column: number; score: number } | null {
  const counts = new Map<number, { matches: number; numeric: number }>();
  const start = Math.max(0, headerRow);
  const end = Math.min(rows.length, start + 500);

  for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    for (let column = 0; column < Math.min(row.length, 60); column += 1) {
      const raw = String(row[column] ?? "").trim();
      if (!raw) continue;
      const current = counts.get(column) || { matches: 0, numeric: 0 };
      if (/^\d+(?:\.\d+)?$/.test(raw)) current.numeric += 1;
      if (/^\d+\.[1-9]\d*$/.test(raw)) current.matches += 1;
      counts.set(column, current);
    }
  }

  const ranked = [...counts.entries()]
    .map(([column, value]) => ({
      column,
      matches: value.matches,
      numeric: value.numeric,
      ratio: value.numeric ? value.matches / value.numeric : 0,
    }))
    .filter((value) => value.matches >= 2 && value.ratio >= 0.45)
    .sort(
      (left, right) =>
        right.matches - left.matches || right.ratio - left.ratio,
    );

  const best = ranked[0];
  if (!best) return null;
  return {
    column: best.column,
    score: best.matches >= 5 && best.ratio >= 0.7 ? 9 : 7,
  };
}

function enrichMemoDetectionFromData(
  detection: RoleDetection,
  rows: unknown[][],
): RoleDetection {
  if (Number.isInteger(detection.columns.memoLine)) return detection;

  const inferred = inferMemoLineColumn(rows, detection.headerRow);
  if (!inferred) return detection;

  return {
    ...detection,
    score: detection.score + inferred.score + 8,
    columns: { ...detection.columns, memoLine: inferred.column },
    fieldScores: {
      ...detection.fieldScores,
      memoLine: inferred.score,
    },
  };
}

function roleNameBonus(title: string, role: "memo" | "tracking" | "master"): number {
  const value = normalize(title);
  if (role === "memo" && /(MEMO|MEMORANDUM|APPROVAL)/.test(value)) return 12;
  if (role === "tracking" && /(TRACK|REGISTER|OUTSTANDING|RETURN|SHEET)/.test(value)) return 10;
  if (role === "master" && /(MASTER|CUSTOMER|PARTY|BROKER|CONTACT)/.test(value)) return 10;
  return 0;
}

function chooseDistinctRoles(sheets: InspectedSheet[]) {
  let best:
    | {
        memo: InspectedSheet;
        tracking: InspectedSheet;
        total: number;
      }
    | undefined;

  for (const memo of sheets) {
    for (const tracking of sheets) {
      if (memo.sheetId === tracking.sheetId) continue;
      const total =
        memo.memo.score +
        roleNameBonus(memo.title, "memo") +
        tracking.tracking.score +
        roleNameBonus(tracking.title, "tracking");
      if (!best || total > best.total) best = { memo, tracking, total };
    }
  }

  return best;
}

function mappedHeaderLabels(
  headers: HeaderOption[],
  columns: Record<string, number>,
): Record<string, string> {
  const byIndex = new Map(headers.map((header) => [header.index, header.label]));
  const labels: Record<string, string> = {};

  for (const [field, column] of Object.entries(columns)) {
    const label = byIndex.get(column)?.trim() || "";
    if (label && !label.includes("(blank heading)")) labels[field] = label;
  }

  return labels;
}

function buildRoleConfig<T extends Record<string, number>>(
  sheet: InspectedSheet,
  role: "memo" | "tracking" | "master",
): RoleConfig<T> {
  const detection = sheet[role];
  return {
    sheetId: sheet.sheetId,
    sheetName: sheet.title,
    headerRow: detection.headerRow,
    columns: detection.columns as T,
    headerLabels: mappedHeaderLabels(
      detection.headers,
      detection.columns,
    ),
  };
}

async function authorizedFetch<T>(
  url: string,
  accessToken: string,
): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Google returned ${response.status}: ${detail.slice(0, 500)}`,
    );
  }

  return (await response.json()) as T;
}

function encodeRange(sheetName: string, range: string): string {
  const quoted = `'${sheetName.replaceAll("'", "''")}'!${range}`;
  return encodeURIComponent(quoted);
}

export async function inspectSpreadsheet(
  spreadsheetId: string,
  accessToken: string,
): Promise<SheetInspection> {
  const driveFile = await authorizedFetch<{
    id?: string;
    name?: string;
    mimeType?: string;
    capabilities?: {
      canEdit?: boolean;
      canModifyContent?: boolean;
    };
  }>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      spreadsheetId,
    )}?fields=id,name,mimeType,capabilities(canEdit,canModifyContent)`,
    accessToken,
  );

  if (driveFile.mimeType !== "application/vnd.google-apps.spreadsheet") {
    throw new Error("Choose a native Google Sheets spreadsheet.");
  }

  const metadata = await authorizedFetch<GoogleSpreadsheetMetadata>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}?fields=spreadsheetId,properties.title,sheets.properties(sheetId,title,hidden,gridProperties(rowCount,columnCount))`,
    accessToken,
  );

  const sheetProperties =
    metadata.sheets
      ?.map((sheet) => sheet.properties)
      .filter((sheet) => sheet.title !== SYSTEM_LOG_SHEET) || [];

  if (sheetProperties.length < 2) {
    throw new Error(
      "The selected spreadsheet does not contain enough worksheets for memorandum and tracking records.",
    );
  }

  const sheets: InspectedSheet[] = [];

  for (const sheet of sheetProperties.slice(0, 25)) {
    const response = await authorizedFetch<{ values?: unknown[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values/${encodeRange(sheet.title, "A1:AZ80")}?valueRenderOption=FORMATTED_VALUE`,
      accessToken,
    );
    const rows = response.values || [];

    const memoDetection = enrichMemoDetectionFromData(
      bestRoleDetection(rows, MEMO_FIELDS),
      rows,
    );

    sheets.push({
      sheetId: sheet.sheetId,
      title: sheet.title,
      hidden: Boolean(sheet.hidden),
      headerRows: headerRowCandidates(rows),
      memo: memoDetection,
      tracking: bestRoleDetection(rows, TRACKING_FIELDS),
      master: bestRoleDetection(rows, MASTER_FIELDS),
    });
  }

  const chosen = chooseDistinctRoles(sheets);
  const warnings: string[] = [];
  let proposed: SheetConnectionConfig | undefined;

  if (chosen) {
    const memoReady = hasStrongRequired(chosen.memo.memo, MEMO_FIELDS);
    const trackingReady = hasStrongRequired(
      chosen.tracking.tracking,
      TRACKING_FIELDS,
    );

    const masterCandidate = sheets
      .filter(
        (sheet) =>
          sheet.sheetId !== chosen.memo.sheetId &&
          sheet.sheetId !== chosen.tracking.sheetId,
      )
      .sort(
        (left, right) =>
          right.master.score +
          roleNameBonus(right.title, "master") -
          (left.master.score + roleNameBonus(left.title, "master")),
      )[0];

    proposed = {
      version: 1,
      spreadsheetId,
      spreadsheetTitle:
        metadata.properties?.title || driveFile.name || "Google Sheet",
      connectedAt: new Date().toISOString(),
      memo: buildRoleConfig<MemoColumns>(chosen.memo, "memo"),
      tracking: buildRoleConfig<TrackingColumns>(
        chosen.tracking,
        "tracking",
      ),
      master:
        masterCandidate && masterCandidate.master.score >= 8
          ? buildRoleConfig<MasterColumns>(masterCandidate, "master")
          : undefined,
    };

    if (!memoReady) {
      warnings.push(
        "The memorandum worksheet was found, but some required memorandum columns need confirmation.",
      );
    }
    if (!trackingReady) {
      warnings.push(
        "The tracking worksheet was found, but some required tracking columns need confirmation.",
      );
    }
    if (!proposed.master) {
      warnings.push(
        "A separate master-data worksheet was not identified. Names and terminology will be learned from the memorandum and tracking records.",
      );
    }
  } else {
    warnings.push(
      "The spreadsheet could not be mapped automatically. Select the memorandum and tracking worksheets manually.",
    );
  }

  const proposedMemoSheet = proposed
    ? sheets.find((sheet) => sheet.sheetId === proposed.memo.sheetId)
    : undefined;
  const proposedTrackingSheet = proposed
    ? sheets.find((sheet) => sheet.sheetId === proposed.tracking.sheetId)
    : undefined;

  const ready = Boolean(
    proposed &&
      proposedMemoSheet &&
      proposedTrackingSheet &&
      hasRequired(proposed.memo.columns, MEMO_FIELDS) &&
      hasRequired(proposed.tracking.columns, TRACKING_FIELDS) &&
      hasStrongRequired(proposedMemoSheet.memo, MEMO_FIELDS) &&
      hasStrongRequired(proposedTrackingSheet.tracking, TRACKING_FIELDS),
  );

  return {
    spreadsheetId,
    spreadsheetTitle:
      metadata.properties?.title || driveFile.name || "Google Sheet",
    canEdit: Boolean(
      driveFile.capabilities?.canEdit ||
        driveFile.capabilities?.canModifyContent,
    ),
    sheets,
    proposed,
    ready,
    warnings,
  };
}

function isIntegerColumn(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < 200;
}

function validateRequiredColumns(
  columns: Record<string, unknown>,
  definitions: Record<string, FieldDefinition>,
  label: string,
) {
  for (const [field, definition] of Object.entries(definitions)) {
    if (definition.required && !isIntegerColumn(columns[field])) {
      throw new Error(`${label}: choose a column for ${field}.`);
    }
  }
}

function validateDistinctColumns(
  columns: Record<string, unknown>,
  label: string,
) {
  const used = new Map<number, string>();

  for (const [field, value] of Object.entries(columns)) {
    if (!isIntegerColumn(value)) continue;
    const previous = used.get(value);
    if (previous) {
      throw new Error(
        `${label}: ${previous} and ${field} cannot use the same spreadsheet column.`,
      );
    }
    used.set(value, field);
  }
}

export function validateConnectionConfig(
  config: SheetConnectionConfig,
  inspection: SheetInspection,
): SheetConnectionConfig {
  const knownSheetIds = new Set(inspection.sheets.map((sheet) => sheet.sheetId));

  if (!knownSheetIds.has(config.memo.sheetId)) {
    throw new Error("Choose a valid memorandum worksheet.");
  }
  if (!knownSheetIds.has(config.tracking.sheetId)) {
    throw new Error("Choose a valid tracking worksheet.");
  }
  if (config.memo.sheetId === config.tracking.sheetId) {
    throw new Error(
      "The memorandum and tracking records must use different worksheets.",
    );
  }

  validateRequiredColumns(
    config.memo.columns as unknown as Record<string, unknown>,
    MEMO_FIELDS,
    "Memorandum worksheet",
  );
  validateRequiredColumns(
    config.tracking.columns as unknown as Record<string, unknown>,
    TRACKING_FIELDS,
    "Tracking worksheet",
  );
  validateDistinctColumns(
    config.memo.columns as unknown as Record<string, unknown>,
    "Memorandum worksheet",
  );
  validateDistinctColumns(
    config.tracking.columns as unknown as Record<string, unknown>,
    "Tracking worksheet",
  );

  const find = (sheetId: number) =>
    inspection.sheets.find((sheet) => sheet.sheetId === sheetId);

  const memoSheet = find(config.memo.sheetId)!;
  const trackingSheet = find(config.tracking.sheetId)!;
  const masterSheet = config.master ? find(config.master.sheetId) : undefined;

  const labelsFor = (
    sheet: InspectedSheet,
    headerRow: number,
    columns: Record<string, number>,
  ) => {
    const headers =
      sheet.headerRows.find((candidate) => candidate.row === headerRow)?.headers ||
      [];
    return mappedHeaderLabels(headers, columns);
  };

  return {
    ...config,
    version: 1,
    spreadsheetId: inspection.spreadsheetId,
    spreadsheetTitle: inspection.spreadsheetTitle,
    connectedAt: new Date().toISOString(),
    memo: {
      ...config.memo,
      sheetName: memoSheet.title,
      headerRow: Math.max(1, config.memo.headerRow || memoSheet.memo.headerRow),
      headerLabels: labelsFor(
        memoSheet,
        Math.max(1, config.memo.headerRow || memoSheet.memo.headerRow),
        config.memo.columns as unknown as Record<string, number>,
      ),
    },
    tracking: {
      ...config.tracking,
      sheetName: trackingSheet.title,
      headerRow: Math.max(
        1,
        config.tracking.headerRow || trackingSheet.tracking.headerRow,
      ),
      headerLabels: labelsFor(
        trackingSheet,
        Math.max(
          1,
          config.tracking.headerRow || trackingSheet.tracking.headerRow,
        ),
        config.tracking.columns as unknown as Record<string, number>,
      ),
    },
    master:
      config.master && masterSheet
        ? {
            ...config.master,
            sheetName: masterSheet.title,
            headerRow: Math.max(
              1,
              config.master.headerRow || masterSheet.master.headerRow,
            ),
            headerLabels: labelsFor(
              masterSheet,
              Math.max(
                1,
                config.master.headerRow || masterSheet.master.headerRow,
              ),
              config.master.columns as unknown as Record<string, number>,
            ),
          }
        : undefined,
  };
}

export async function getStoredSheetConnection(): Promise<SheetConnectionConfig | null> {
  const store = await cookies();
  return unsealJson<SheetConnectionConfig>(
    store.get(SHEET_CONNECTION_COOKIE)?.value,
  );
}

export function legacySheetConnection(): SheetConnectionConfig | null {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!spreadsheetId) return null;

  return {
    version: 1,
    spreadsheetId,
    spreadsheetTitle: "Configured Google Sheet",
    connectedAt: "legacy",
    memo: {
      sheetId: -1,
      sheetName: "MEMO",
      headerRow: 1,
      columns: {
        memoLine: 0,
        date: 1,
        recipient: 3,
        through: 4,
        shape: 5,
        size: 6,
        quality: 7,
        carats: 8,
        askingPrice: 9,
        remarks: 10,
        status: 11,
      },
    },
    tracking: {
      sheetId: -2,
      sheetName: "SHEET1",
      headerRow: 1,
      columns: {
        sentDate: 0,
        returnDate: 1,
        memoNumber: 2,
        customer: 3,
        through: 4,
        shape: 6,
        size: 7,
        color: 8,
        quality: 9,
        carats: 10,
        askingPrice: 11,
        remarks: 12,
        confirmPerson: 13,
        confirmDate: 14,
        confirmTime: 15,
      },
    },
    master: {
      sheetId: -3,
      sheetName: "CUT. MASTER",
      headerRow: 1,
      columns: {
        broker: 2,
        party: 5,
        operator: 8,
      },
    },
  };
}

export async function getActiveSheetConnection(): Promise<{
  config: SheetConnectionConfig;
  mode: "oauth" | "legacy";
}> {
  const stored = await getStoredSheetConnection();
  if (stored) return { config: stored, mode: "oauth" };

  const legacy = legacySheetConnection();
  if (legacy) return { config: legacy, mode: "legacy" };

  throw new Error("No Google Sheet is connected.");
}

export function resolveRoleSheet<TColumns>(
  metadata: GoogleSpreadsheetMetadata,
  role: RoleConfig<TColumns>,
) {
  const sheets = metadata.sheets?.map((sheet) => sheet.properties) || [];

  if (role.sheetId >= 0) {
    const byId = sheets.find((sheet) => sheet.sheetId === role.sheetId);
    if (byId) return byId;
  }

  return sheets.find((sheet) => sheet.title === role.sheetName) || null;
}

export function columnLetter(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}
