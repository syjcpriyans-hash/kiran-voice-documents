"use client";

import { Ban, Search } from "lucide-react";
import { useState } from "react";
import type { ReturnLookupResult } from "@/lib/types";

export function VoidWorkflow() {
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ReturnLookupResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);

  async function lookup() {
    if (!reference.trim()) return;
    setBusy(true);
    setResult(null);
    setConfirmed(false);
    setMessage(null);
    try {
      const response = await fetch(`/api/returns/lookup?reference=${encodeURIComponent(reference.trim())}`);
      const data = (await response.json()) as { result?: ReturnLookupResult; error?: string };
      if (!response.ok || !data.result) throw new Error(data.error || "The memorandum was not found.");
      setResult(data.result);
      if (data.result.source !== "SYSTEM_LOG") {
        setMessage({ type: "warning", text: "This historical memorandum does not have a safe app audit link, so it cannot be voided automatically." });
      } else if (data.result.voided) {
        setMessage({ type: "warning", text: `Memo ${data.result.memoNumber} is already void${data.result.voidReason ? `: ${data.result.voidReason}` : "."}` });
      } else if (data.result.alreadyReturned) {
        setMessage({ type: "warning", text: "This memorandum is already returned and cannot be voided automatically." });
      }
    } catch (cause) {
      setMessage({ type: "error", text: cause instanceof Error ? cause.message : "The memorandum lookup failed." });
    } finally {
      setBusy(false);
    }
  }

  async function voidMemo() {
    if (!result || !confirmed || reason.trim().length < 3) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/voids/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          reference: result.memoNumber,
          reason: reason.trim(),
        }),
      });
      const data = (await response.json()) as { result?: ReturnLookupResult & { message?: string }; error?: string };
      if (!response.ok || !data.result) throw new Error(data.error || "The memorandum could not be voided.");
      setResult(data.result);
      setMessage({ type: "success", text: data.result.message || `Memo ${data.result.memoNumber} was marked void.` });
      setConfirmed(false);
    } catch (cause) {
      setMessage({ type: "error", text: cause instanceof Error ? cause.message : "The void update failed." });
    } finally {
      setBusy(false);
    }
  }

  const safeToVoid = Boolean(
    result &&
    result.source === "SYSTEM_LOG" &&
    !result.voided &&
    !result.alreadyReturned &&
    result.memoRows.length &&
    result.sheet1Rows.length,
  );

  return (
    <div>
      <div className="notice warning">
        Voiding never deletes business history. It marks linked MEMO rows as VOID, adds the reason to SHEET1 remarks and keeps the audit record.
      </div>

      <div className="field-grid top-gap">
        <div className="field field-wide">
          <label htmlFor="void-reference">Memo reference</label>
          <input
            id="void-reference"
            value={reference}
            onChange={(event) => { setReference(event.target.value); setResult(null); setConfirmed(false); }}
            placeholder="Enter the internal memo number created by this app"
          />
        </div>
        <div className="field field-wide">
          <label htmlFor="void-reason">Reason for voiding</label>
          <input
            id="void-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Example: Incorrect carat value; replacement memo will be created"
          />
        </div>
      </div>

      <div className="actions top-gap">
        <button type="button" className="btn btn-secondary" onClick={lookup} disabled={busy || !reference.trim()}>
          <Search size={17} /> Find memorandum
        </button>
      </div>

      {result && (
        <div className="lookup-card top-gap">
          <div><strong>Memo:</strong> {result.memoNumber}</div>
          <div><strong>Recipient:</strong> {result.recipient || "—"}</div>
          <div><strong>Items:</strong> {result.itemCount}</div>
          <div><strong>MEMO rows:</strong> {result.memoRows.join(", ") || "No safe link"}</div>
          <div><strong>SHEET1 rows:</strong> {result.sheet1Rows.join(", ") || "No safe link"}</div>
          <div><strong>Status:</strong> {result.voided ? "VOID" : result.alreadyReturned ? "RETURNED" : "ACTIVE"}</div>
        </div>
      )}

      {safeToVoid && (
        <label className="confirmation-check top-gap">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>I verified the memo, linked rows and void reason. I understand that a corrected transaction must be created as a new memorandum.</span>
        </label>
      )}

      {message && <div className={`notice ${message.type} top-gap`}>{message.text}</div>}

      {safeToVoid && (
        <button
          type="button"
          className="btn btn-danger btn-large top-gap"
          onClick={voidMemo}
          disabled={busy || !confirmed || reason.trim().length < 3}
        >
          <Ban size={18} /> {busy ? "Voiding…" : "Mark memorandum VOID"}
        </button>
      )}
    </div>
  );
}
