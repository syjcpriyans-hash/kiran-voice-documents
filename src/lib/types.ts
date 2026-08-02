export type RecipientType = "Broker" | "Customer" | "Other";

export type ApprovalItem = {
  id: string;
  sourceRowId?: string | null;
  sourceSerialNumber?: string | null;
  size: string;
  description: string;
  carats: number;
  askingPrice: number;
  remarks: string;
};

export type ApprovalDraft = {
  recipientName: string;
  recipientType: RecipientType;
  through: string;
  date: string;
  items: ApprovalItem[];
};

export type InterpretedItem = {
  size: string;
  descriptionQuery: string;
  carats: number;
  askingPrice?: number;
  remarks?: string;
};

export type InterpretedDraft = {
  recipientName: string;
  recipientType: RecipientType;
  through: string;
  date?: string;
  items: InterpretedItem[];
};

export type MasterMatch = {
  kind: "recipient" | "through" | "shape" | "size" | "quality" | "operator";
  input: string;
  canonical: string;
  confidence: number;
  ambiguous: boolean;
  alternatives: string[];
};

export type MasterData = {
  brokers: string[];
  parties: string[];
  operators: string[];
  shapes: string[];
  sizes: string[];
  qualities: string[];
  descriptions: string[];
  loadedAt: string;
};

export type WorkbookInspection = {
  fileName: string;
  fileSize: number;
  sheets: Array<{
    name: string;
    headers: string[];
    sampleRows: Record<string, unknown>[];
    rowCount: number;
  }>;
};

export type WorkbookImportResult = {
  importId: string;
  rowCount: number;
  workbookPath: string;
  sheetName: string;
};

export type CommittedDocument = {
  id: string;
  serial_number: string;
  memo_number: string;
  total_carats: number;
  sheet_write_status: "completed";
  memo_rows: string;
  sheet1_rows: string;
  is_new: boolean;
};

export type HistoryRecord = {
  requestId: string;
  status: string;
  memoNumber: string;
  memoRows: string;
  sheet1Rows: string;
  totalCarats: number;
  recipient: string;
  createdAt: string;
  returnedStatus?: string;
  returnedAt?: string;
  confirmPerson?: string;
  voidStatus?: string;
  voidedAt?: string;
  voidReason?: string;
  document: {
    requestId: string;
    recipientName: string;
    recipientType: RecipientType;
    through: string;
    documentDate: string;
    items: Array<{
      size: string;
      description: string;
      carats: number;
      askingPrice: number;
      remarks: string;
    }>;
  } | null;
};

export type ReturnLookupResult = {
  reference: string;
  memoNumber: string;
  recipient: string;
  through: string;
  memoRows: number[];
  sheet1Rows: number[];
  itemCount: number;
  alreadyReturned: boolean;
  returnDate?: string;
  voided?: boolean;
  voidedAt?: string;
  voidReason?: string;
  canUpdateMemo: boolean;
  canUpdateSheet1: boolean;
  source: "SYSTEM_LOG" | "SHEET1" | "MEMO";
  warning?: string;
};
