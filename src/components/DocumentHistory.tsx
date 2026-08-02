"use client";

import { History, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ApprovalDraft, HistoryRecord } from "@/lib/types";

export function DocumentHistory({
  onLoad,
}: {
  onLoad: (draft: ApprovalDraft, memoNumber: string) => void;
}) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (search = "") => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/history?q=${encodeURIComponent(search)}`);
      const data = (await response.json()) as { records?: HistoryRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error || "History could not be loaded.");
      setRecords(data.records || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "History could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function loadRecord(record: HistoryRecord) {
    if (!record.document) return;
    onLoad(
      {
        recipientName: record.document.recipientName,
        recipientType: record.document.recipientType,
        through: record.document.through,
        date: record.document.documentDate,
        items: record.document.items.map((item) => ({
          id: crypto.randomUUID(),
          size: item.size,
          description: item.description,
          carats: item.carats,
          askingPrice: item.askingPrice,
          remarks: item.remarks,
        })),
      },
      record.memoNumber,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div>
      <div className="history-toolbar">
        <div className="field history-search">
          <label htmlFor="history-query">Search memorandum number, recipient, or confirmation person</label>
          <input id="history-query" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(query); }} />
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => load(query)} disabled={busy}>
            <Search size={17} /> Search
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => { setQuery(""); void load(); }} disabled={busy}>
            <RefreshCw size={17} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="notice error top-gap">{error}</div>}
      {!busy && records.length === 0 && <div className="muted top-gap">No memorandum history was found.</div>}

      <div className="history-list top-gap">
        {records.map((record) => (
          <article className="history-card" key={record.requestId}>
            <div>
              <div className="history-title"><History size={17} /> Memorandum {record.memoNumber}</div>
              <div className="muted">{record.recipient || "Unknown recipient"} · {record.totalCarats.toFixed(2)} carats</div>
              <div className="history-meta">Created: {record.createdAt || "—"}</div>
              <div className="history-meta">Status: {record.voidStatus === "VOID" || record.status === "VOID" ? `Voided${record.voidReason ? ` — ${record.voidReason}` : ""}` : `${record.returnedStatus === "RETURNED" ? "Returned" : "Outstanding"}${record.confirmPerson ? ` · Confirmed by ${record.confirmPerson}` : ""}`}</div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => loadRecord(record)} disabled={!record.document}>
              Open for document download or correction
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
