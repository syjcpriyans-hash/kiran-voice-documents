"use client";

import { Download, Plus, Printer, Save, Trash2 } from "lucide-react";
import { flushSync } from "react-dom";
import { useState } from "react";
import { formatApprovalDate, formatIndianCurrency, totalCarats } from "@/lib/calculations";
import type { ApprovalDraft, ApprovalItem, CommittedDocument } from "@/lib/types";

export function ApprovalNoteEditor({ draft, onChange }: { draft: ApprovalDraft; onChange: (draft: ApprovalDraft) => void }) {
  const [serialNumber, setSerialNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);

  const total = totalCarats(draft.items);

  function invalidateGeneratedDocument() {
    setSerialNumber("");
    setMessage(null);
  }

  function updateDraft(patch: Partial<ApprovalDraft>) {
    invalidateGeneratedDocument();
    onChange({ ...draft, ...patch });
  }

  function updateItem(id: string, patch: Partial<ApprovalItem>) {
    invalidateGeneratedDocument();
    onChange({
      ...draft,
      items: draft.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }

  function addItem() {
    if (draft.items.length >= 8) {
      setMessage({ type: "warning", text: "This approval-note format supports a maximum of eight rows." });
      return;
    }

    invalidateGeneratedDocument();
    onChange({
      ...draft,
      items: [
        ...draft.items,
        {
          id: crypto.randomUUID(),
          size: "",
          description: "",
          carats: 0,
          askingPrice: draft.items.at(-1)?.askingPrice || 0,
          remarks: "",
        },
      ],
    });
  }

  function removeItem(id: string) {
    invalidateGeneratedDocument();
    onChange({ ...draft, items: draft.items.filter((item) => item.id !== id) });
  }

  function validateDraft(): string | null {
    if (!draft.recipientName.trim()) return "Enter or speak the recipient name.";
    if (!draft.date) return "Choose the document date.";
    if (!draft.items.length) return "Add at least one product row.";
    if (draft.items.length > 8) return "This format supports a maximum of eight rows.";

    const incomplete = draft.items.find(
      (item) => !item.size.trim() || !item.description.trim() || !Number.isFinite(item.carats) || item.carats <= 0 || !Number.isFinite(item.askingPrice),
    );
    if (incomplete) return "Complete the size, description, carats and asking price for every row.";
    return null;
  }

  async function createPdf(serial: string) {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    const target = document.getElementById("approval-note");
    if (!target) throw new Error("The approval-note preview could not be found.");

    target.setAttribute("data-export-serial", serial);
    const canvas = await html2canvas(target, {
      scale: 2.25,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const pageWidth = 297;
    const pageHeight = 210;
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    const imageWidth = canvas.width * ratio;
    const imageHeight = canvas.height * ratio;
    const x = (pageWidth - imageWidth) / 2;
    const y = (pageHeight - imageHeight) / 2;

    pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", x, y, imageWidth, imageHeight, undefined, "FAST");
    const safeSerial = serial.replaceAll(/[^a-zA-Z0-9-]+/g, "-");
    pdf.save(`${safeSerial || "approval-note"}.pdf`);
  }

  async function generateRecordAndDownload() {
    const validationError = validateDraft();
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const requestId = crypto.randomUUID();
      const response = await fetch("/api/documents/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          recipientName: draft.recipientName.trim(),
          recipientType: draft.recipientType,
          through: draft.through.trim(),
          documentDate: draft.date,
          items: draft.items.map((item) => ({
            sourceRowId: item.sourceRowId || null,
            sourceSerialNumber: item.sourceSerialNumber || null,
            size: item.size.trim(),
            description: item.description.trim(),
            carats: Number(item.carats),
            askingPrice: Number(item.askingPrice),
            remarks: item.remarks.trim(),
          })),
        }),
      });

      const data = (await response.json()) as { document?: CommittedDocument; error?: string };
      if (!response.ok || !data.document) throw new Error(data.error || "The document could not be recorded.");

      flushSync(() => setSerialNumber(data.document!.serial_number));
      await createPdf(data.document.serial_number);

      if (data.document.excel_sync_status === "completed") {
        setMessage({
          type: "success",
          text: `${data.document.serial_number} was recorded in Supabase, written to the Excel workbook and downloaded as a PDF.`,
        });
      } else {
        setMessage({
          type: "warning",
          text: `${data.document.serial_number} was recorded and downloaded, but the Excel write-back failed. The same document can be retried later without creating a second serial number.`,
        });
      }
    } catch (cause) {
      setMessage({ type: "error", text: cause instanceof Error ? cause.message : "Document generation failed." });
    } finally {
      setBusy(false);
    }
  }

  async function downloadRecordedPdf() {
    if (!serialNumber) return;
    setBusy(true);
    try {
      await createPdf(serialNumber);
    } catch (cause) {
      setMessage({ type: "error", text: cause instanceof Error ? cause.message : "PDF generation failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="field-grid document-fields">
        <div className="field field-wide">
          <label htmlFor="recipient-name">Recipient name captured from speech</label>
          <input id="recipient-name" value={draft.recipientName} onChange={(event) => updateDraft({ recipientName: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="recipient-type">Recipient type</label>
          <select id="recipient-type" value={draft.recipientType} onChange={(event) => updateDraft({ recipientType: event.target.value as ApprovalDraft["recipientType"] })}>
            <option value="Broker">Broker</option>
            <option value="Customer">Customer</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="through">Through</label>
          <input id="through" value={draft.through} onChange={(event) => updateDraft({ through: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="document-date">Date</label>
          <input id="document-date" type="date" value={draft.date} onChange={(event) => updateDraft({ date: event.target.value })} />
        </div>
      </div>

      <div className="document-frame">
        <section id="approval-note" className="approval-note">
          <div className="note-title">MEMORANDUM / APPROVAL NOTE</div>
          <header className="note-header">
            <div className="kiran-logo" aria-label="Kiran logo placeholder">K</div>
            <div>
              <div className="company-name">KIRAN GEMS PRIVATE LIMITED</div>
              <div className="company-lines">
                FE-5011, Bharat Diamond Bourse,<br />
                “G” Block, Bandra-Kurla Complex,<br />
                Bandra (East), Mumbai - 400 051, India.<br />
                Tel.: +91 22 4050 4444 · Fax: +91 22 4050 4455<br />
                Website: www.kirangems.com
              </div>
            </div>
            <div className="cert-box">CERTIFICATION LOGOS<br />LOCKED TEMPLATE AREA</div>
          </header>

          <div className="system-reference">System Ref: {serialNumber || "Generated after confirmation"}</div>

          <div className="meta-row">
            <div>To:</div>
            <div className="dot-line">
              {draft.recipientName} {draft.recipientType !== "Other" ? `(${draft.recipientType})` : ""}
            </div>
            <div>Date:</div>
            <div className="dot-line">{formatApprovalDate(draft.date)}</div>
          </div>
          <div className="meta-row through-row">
            <div>Through:</div>
            <div className="dot-line">{draft.through}</div>
          </div>

          <table className="approval-table">
            <colgroup>
              <col style={{ width: "6%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "38%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "11%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>SR. NO.</th>
                <th>SIZE</th>
                <th>DESCRIPTION - CUT &amp; POLISHED DIAMONDS</th>
                <th>CARATS</th>
                <th>ASKING PRICE</th>
                <th>REMARKS</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, index) => {
                const item = draft.items[index];
                const repeatPrice = item && index > 0 && draft.items[index - 1]?.askingPrice === item.askingPrice;
                return (
                  <tr key={item?.id || `empty-${index}`}>
                    <td>{item ? index + 1 : ""}</td>
                    <td>{item?.size || ""}</td>
                    <td className="description-cell">{item?.description || ""}</td>
                    <td>{item ? Number(item.carats).toFixed(2) : ""}</td>
                    <td>{item ? (repeatPrice ? '"' : formatIndianCurrency(item.askingPrice)) : ""}</td>
                    <td>{item?.remarks || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <footer className="note-footer">
            <div className="signature-block"><span>Customer’s Signature</span></div>
            <div className="total-block">
              <strong>TOTAL -</strong>
              <strong>{total.toFixed(2)} Cts.</strong>
            </div>
            <div className="signature-block right-signature">
              <span>For Kiran Gems Private Limited</span>
              <strong>Authorised Signatory</strong>
            </div>
          </footer>
        </section>
      </div>

      <div className="editor-card">
        <div className="editor-heading">
          <div>
            <h3>Edit extracted product rows</h3>
            <p className="muted">The real Excel mapping will replace manual row editing after the workbook is available.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={addItem} disabled={draft.items.length >= 8 || busy}>
            <Plus size={17} /> Add row
          </button>
        </div>

        <div className="item-editor">
          <table className="item-table">
            <thead>
              <tr>
                <th>Size</th>
                <th>Description</th>
                <th>Carats</th>
                <th>Asking price</th>
                <th>Remarks</th>
                <th aria-label="Remove row" />
              </tr>
            </thead>
            <tbody>
              {draft.items.map((item) => (
                <tr key={item.id}>
                  <td><input value={item.size} onChange={(event) => updateItem(item.id, { size: event.target.value })} /></td>
                  <td><input value={item.description} onChange={(event) => updateItem(item.id, { description: event.target.value })} /></td>
                  <td><input type="number" step="0.01" min="0" value={item.carats} onChange={(event) => updateItem(item.id, { carats: Number(event.target.value) })} /></td>
                  <td><input type="number" step="1" min="0" value={item.askingPrice} onChange={(event) => updateItem(item.id, { askingPrice: Number(event.target.value) })} /></td>
                  <td><input value={item.remarks} onChange={(event) => updateItem(item.id, { remarks: event.target.value })} /></td>
                  <td>
                    <button type="button" className="icon-button danger" onClick={() => removeItem(item.id)} aria-label="Remove row" disabled={busy}>
                      <Trash2 size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {message && <div className={`notice ${message.type} top-gap`}>{message.text}</div>}

      <div className="generation-actions">
        <button type="button" className="btn btn-success btn-large" onClick={generateRecordAndDownload} disabled={busy}>
          <Save size={19} /> {busy ? "Generating…" : "Generate, record serial & download PDF"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={downloadRecordedPdf} disabled={busy || !serialNumber}>
          <Download size={18} /> Download again
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => window.print()} disabled={busy}>
          <Printer size={18} /> Print preview
        </button>
      </div>
    </div>
  );
}
