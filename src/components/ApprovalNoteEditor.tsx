"use client";

import { Download, Plus, Printer, Save, Trash2 } from "lucide-react";
import { flushSync } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { formatApprovalDate, formatIndianCurrency, totalCarats } from "@/lib/calculations";
import type { ApprovalDraft, ApprovalItem, CommittedDocument, MasterData } from "@/lib/types";

function formatDiamondDescription(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const bracketMatch = trimmed.toUpperCase().match(/^\[\s*([^\]]+)\s*\]\s*\[\s*([^\]]+)\s*\]$/);
  if (bracketMatch) return `[ ${bracketMatch[1].trim()} ] [ ${bracketMatch[2].trim()} ]`;

  const compact = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const clarityMatch = compact.match(/FL|IF|VVS[12]|VS[12]|SI[123]|I[123]/);
  if (!clarityMatch || clarityMatch.index === undefined) return trimmed.toUpperCase().replace(/\s+/g, " ");

  const category = compact.slice(0, clarityMatch.index);
  const clarityToken = clarityMatch[0];
  const color = compact.slice(clarityMatch.index + clarityToken.length);
  const clarity = clarityToken.replace(/(VVS|VS|SI|I)([1-3])$/, "$1-$2");
  if (!category) return trimmed.toUpperCase().replace(/\s+/g, " ");
  return color ? `[ ${category} ] [ ${clarity} (${color}) ]` : `[ ${category} ] [ ${clarity} ]`;
}

export function ApprovalNoteEditor({
  draft,
  onChange,
  initialSerialNumber = "",
}: {
  draft: ApprovalDraft;
  onChange: (draft: ApprovalDraft) => void;
  initialSerialNumber?: string;
}) {
  const [serialNumber, setSerialNumber] = useState(initialSerialNumber);
  const [historicalMode, setHistoricalMode] = useState(Boolean(initialSerialNumber));
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);
  const [master, setMaster] = useState<MasterData | null>(null);
  const [checkedNames, setCheckedNames] = useState(false);
  const [checkedNumbers, setCheckedNumbers] = useState(false);

  useEffect(() => {
    setSerialNumber(initialSerialNumber);
    setHistoricalMode(Boolean(initialSerialNumber));
    setMessage(initialSerialNumber ? { type: "success", text: `Historical memo ${initialSerialNumber} is loaded for PDF regeneration. Editing any field will create a new draft.` } : null);
  }, [initialSerialNumber]);

  useEffect(() => {
    void fetch("/api/master-data")
      .then((response) => response.json())
      .then((payload: { data?: MasterData }) => setMaster(payload.data || null))
      .catch(() => undefined);
  }, []);

  const total = totalCarats(draft.items);
  const recipientOptions = useMemo(() => [...new Set([...(master?.parties || []), ...(master?.brokers || [])])], [master]);

  function invalidateGeneratedDocument() {
    setSerialNumber("");
    setHistoricalMode(false);
    setRequestId(crypto.randomUUID());
    setCheckedNames(false);
    setCheckedNumbers(false);
    setMessage(null);
  }

  function updateDraft(patch: Partial<ApprovalDraft>) {
    invalidateGeneratedDocument();
    onChange({ ...draft, ...patch });
  }

  function updateItem(id: string, patch: Partial<ApprovalItem>) {
    invalidateGeneratedDocument();
    onChange({ ...draft, items: draft.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  }

  function addItem() {
    if (draft.items.length >= 8) {
      setMessage({ type: "warning", text: "This approval-note format supports a maximum of eight rows." });
      return;
    }
    invalidateGeneratedDocument();
    onChange({
      ...draft,
      items: [...draft.items, {
        id: crypto.randomUUID(),
        size: "",
        description: "",
        carats: 0,
        askingPrice: draft.items.at(-1)?.askingPrice || 0,
        remarks: "",
      }],
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

    const incomplete = draft.items.find((item) =>
      !item.size.trim() || !item.description.trim() || !Number.isFinite(item.carats) || item.carats <= 0 || !Number.isFinite(item.askingPrice) || item.askingPrice <= 0,
    );
    if (incomplete) return "Complete the size, description, carats and asking price for every row.";

    const signatures = draft.items.map((item) => [
      item.size.trim().toUpperCase(),
      formatDiamondDescription(item.description),
      Number(item.carats).toFixed(2),
      Number(item.askingPrice).toFixed(2),
      item.remarks.trim().toUpperCase(),
    ].join("|"));
    if (new Set(signatures).size !== signatures.length) return "Two product rows are exact duplicates. Remove or correct the duplicate before recording.";
    if (!checkedNames || !checkedNumbers) return "Confirm both review checkboxes before updating Google Sheets.";
    return null;
  }

  async function createPdf(serial: string) {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    const target = document.getElementById("approval-note");
    if (!target) throw new Error("The approval-note preview could not be found.");

    target.setAttribute("data-export-serial", serial);
    const canvas = await html2canvas(target, { scale: 2.25, backgroundColor: "#ffffff", useCORS: true, logging: false });
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const pageWidth = 297;
    const pageHeight = 210;
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    const imageWidth = canvas.width * ratio;
    const imageHeight = canvas.height * ratio;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", (pageWidth - imageWidth) / 2, (pageHeight - imageHeight) / 2, imageWidth, imageHeight, undefined, "FAST");
    pdf.save(`${serial.replaceAll(/[^a-zA-Z0-9-]+/g, "-") || "approval-note"}.pdf`);
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
            description: formatDiamondDescription(item.description),
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
      setMessage({ type: "success", text: `Memo ${data.document.memo_number} was written to MEMO rows ${data.document.memo_rows} and SHEET1 rows ${data.document.sheet1_rows}, then downloaded as a PDF.` });
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
      <datalist id="recipient-master">{recipientOptions.slice(0, 2500).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="broker-master">{master?.brokers.slice(0, 1000).map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="size-master">{master?.sizes.map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="description-master">{master?.descriptions.map((value) => <option key={value} value={value} />)}</datalist>

      <div className="field-grid document-fields">
        <div className="field field-wide">
          <label htmlFor="recipient-name">Recipient name</label>
          <input id="recipient-name" list="recipient-master" value={draft.recipientName} onChange={(event) => updateDraft({ recipientName: event.target.value })} />
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
          <input id="through" list="broker-master" value={draft.through} onChange={(event) => updateDraft({ through: event.target.value })} />
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
              <div className="company-lines">FE-5011, Bharat Diamond Bourse,<br />“G” Block, Bandra-Kurla Complex,<br />Bandra (East), Mumbai - 400 051, India.<br />Tel.: +91 22 4050 4444 · Fax: +91 22 4050 4455<br />Website: www.kirangems.com</div>
            </div>
            <div className="cert-box">CERTIFICATION LOGOS<br />LOCKED TEMPLATE AREA</div>
          </header>
          <div className="system-reference">Memo No.: {serialNumber || "Generated after confirmation"}</div>
          <div className="meta-row"><div>To:</div><div className="dot-line">{draft.recipientName} {draft.recipientType !== "Other" ? `(${draft.recipientType})` : ""}</div><div>Date:</div><div className="dot-line">{formatApprovalDate(draft.date)}</div></div>
          <div className="meta-row through-row"><div>Through:</div><div className="dot-line">{draft.through}</div></div>
          <table className="approval-table">
            <colgroup><col style={{ width: "6%" }} /><col style={{ width: "14%" }} /><col style={{ width: "38%" }} /><col style={{ width: "15%" }} /><col style={{ width: "16%" }} /><col style={{ width: "11%" }} /></colgroup>
            <thead><tr><th>SR. NO.</th><th>SIZE</th><th>DESCRIPTION - CUT &amp; POLISHED DIAMONDS</th><th>CARATS</th><th>ASKING PRICE</th><th>REMARKS</th></tr></thead>
            <tbody>{Array.from({ length: 8 }).map((_, index) => {
              const item = draft.items[index];
              const repeatPrice = item && index > 0 && draft.items[index - 1]?.askingPrice === item.askingPrice;
              return <tr key={item?.id || `empty-${index}`}><td>{item ? index + 1 : ""}</td><td>{item?.size || ""}</td><td className="description-cell">{item ? formatDiamondDescription(item.description) : ""}</td><td>{item ? Number(item.carats).toFixed(2) : ""}</td><td>{item ? (repeatPrice ? '"' : formatIndianCurrency(item.askingPrice)) : ""}</td><td>{item?.remarks || ""}</td></tr>;
            })}</tbody>
          </table>
          <footer className="note-footer"><div className="signature-block"><span>Customer’s Signature</span></div><div className="total-block"><strong>TOTAL -</strong><strong>{total.toFixed(2)} Cts.</strong></div><div className="signature-block right-signature"><span>For Kiran Gems Private Limited</span><strong>Authorised Signatory</strong></div></footer>
        </section>
      </div>

      <div className="editor-card">
        <div className="editor-heading"><div><h3>Edit extracted product rows</h3><p className="muted">Names and terminology are suggested from CUT. MASTER and MEMO. New values are still allowed after review.</p></div><button type="button" className="btn btn-secondary" onClick={addItem} disabled={draft.items.length >= 8 || busy}><Plus size={17} /> Add row</button></div>
        <div className="item-editor"><table className="item-table"><thead><tr><th>Size</th><th>Description</th><th>Carats</th><th>Asking price</th><th>Remarks</th><th aria-label="Remove row" /></tr></thead><tbody>{draft.items.map((item) => <tr key={item.id}>
          <td><input list="size-master" value={item.size} onChange={(event) => updateItem(item.id, { size: event.target.value })} /></td>
          <td><input list="description-master" value={item.description} onChange={(event) => updateItem(item.id, { description: event.target.value })} onBlur={() => updateItem(item.id, { description: formatDiamondDescription(item.description) })} /></td>
          <td><input type="number" step="0.01" min="0" value={item.carats} onChange={(event) => updateItem(item.id, { carats: Number(event.target.value) })} /></td>
          <td><input type="number" step="1" min="0" value={item.askingPrice} onChange={(event) => updateItem(item.id, { askingPrice: Number(event.target.value) })} /></td>
          <td><input value={item.remarks} onChange={(event) => updateItem(item.id, { remarks: event.target.value })} /></td>
          <td><button type="button" className="icon-button danger" onClick={() => removeItem(item.id)} aria-label="Remove row" disabled={busy}><Trash2 size={17} /></button></td>
        </tr>)}</tbody></table></div>
      </div>

      {!historicalMode && (
        <div className="confirmation-panel top-gap">
          <label className="confirmation-check"><input type="checkbox" checked={checkedNames} onChange={(event) => setCheckedNames(event.target.checked)} /><span>I checked the recipient, through name, sizes and descriptions.</span></label>
          <label className="confirmation-check"><input type="checkbox" checked={checkedNumbers} onChange={(event) => setCheckedNumbers(event.target.checked)} /><span>I checked every carat, asking price and total.</span></label>
        </div>
      )}

      {message && <div className={`notice ${message.type} top-gap`}>{message.text}</div>}
      <div className="generation-actions">
        {!historicalMode && <button type="button" className="btn btn-success btn-large" onClick={generateRecordAndDownload} disabled={busy || !checkedNames || !checkedNumbers}><Save size={19} /> {busy ? "Updating Google Sheet…" : "Update Google Sheet & download PDF"}</button>}
        <button type="button" className="btn btn-secondary" onClick={downloadRecordedPdf} disabled={busy || !serialNumber}><Download size={18} /> Download PDF</button>
        <button type="button" className="btn btn-secondary" onClick={() => window.print()} disabled={busy}><Printer size={18} /> Print preview</button>
      </div>
    </div>
  );
}
