"use client";

import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { WorkbookImportResult, WorkbookInspection } from "@/lib/types";

export function WorkbookUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<WorkbookInspection | null>(null);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [importResult, setImportResult] = useState<WorkbookImportResult | null>(null);
  const [busy, setBusy] = useState<"inspect" | "import" | null>(null);
  const [error, setError] = useState("");

  async function inspect(selectedFile: File) {
    setBusy("inspect");
    setError("");
    setImportResult(null);
    try {
      const body = new FormData();
      body.append("file", selectedFile);
      const response = await fetch("/api/workbook/inspect", { method: "POST", body });
      const data = (await response.json()) as WorkbookInspection & { error?: string };
      if (!response.ok) throw new Error(data.error || "Workbook inspection failed.");
      setFile(selectedFile);
      setInspection(data);
      setSelectedSheet(data.sheets[0]?.name || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workbook inspection failed.");
    } finally {
      setBusy(null);
    }
  }

  async function importWorkbook() {
    if (!file || !selectedSheet) return;
    setBusy("import");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("sheetName", selectedSheet);
      const response = await fetch("/api/workbook/import", { method: "POST", body });
      const data = (await response.json()) as WorkbookImportResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "Workbook import failed.");
      setImportResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workbook import failed.");
    } finally {
      setBusy(null);
    }
  }

  const activeSheet = inspection?.sheets.find((sheet) => sheet.name === selectedSheet);

  return (
    <div>
      <div className="upload-zone">
        <FileSpreadsheet size={40} className="brand-icon" />
        <h3>Upload the master Excel workbook</h3>
        <p className="muted">The app first inspects the workbook. You then choose which sheet contains the product data.</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void inspect(selected);
          }}
        />
        <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={Boolean(busy)}>
          <Upload size={18} /> {busy === "inspect" ? "Inspecting…" : "Choose Excel file"}
        </button>
      </div>

      {error && <div className="notice error top-gap">{error}</div>}

      {inspection && (
        <div className="workbook-results">
          <div className="notice success">Found {inspection.sheets.length} sheet(s) in {inspection.fileName}.</div>

          <div className="field top-gap">
            <label htmlFor="source-sheet">Sheet containing product data</label>
            <select id="source-sheet" value={selectedSheet} onChange={(event) => setSelectedSheet(event.target.value)}>
              {inspection.sheets.map((sheet) => (
                <option key={sheet.name} value={sheet.name}>
                  {sheet.name} — {sheet.rowCount} rows
                </option>
              ))}
            </select>
          </div>

          {activeSheet && (
            <div className="sheet-summary">
              <strong>{activeSheet.name}</strong>
              <span>{activeSheet.rowCount} data rows</span>
              <div className="header-chips">
                {activeSheet.headers.length ? activeSheet.headers.map((header) => <span key={header}>{header}</span>) : <span>No headers detected</span>}
              </div>
            </div>
          )}

          <button type="button" className="btn btn-success full-width top-gap" onClick={importWorkbook} disabled={busy === "import" || !selectedSheet}>
            <CheckCircle2 size={18} /> {busy === "import" ? "Importing to Supabase…" : "Import selected sheet"}
          </button>
        </div>
      )}

      {importResult && (
        <div className="notice success top-gap">
          Imported {importResult.rowCount} rows from <strong>{importResult.sheetName}</strong>. The uploaded workbook is now the current master copy.
        </div>
      )}
    </div>
  );
}
