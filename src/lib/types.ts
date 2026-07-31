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
  total_carats: number;
  excel_sync_status: "pending" | "completed" | "failed";
  is_new: boolean;
  sync_error?: string;
};
