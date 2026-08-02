"use client";

import {
  Ban,
  FileCheck2,
  FileSpreadsheet,
  History,
  Mic2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { ApprovalNoteEditor } from "@/components/ApprovalNoteEditor";
import { DocumentHistory } from "@/components/DocumentHistory";
import { GoogleSheetStatus } from "@/components/GoogleSheetStatus";
import { ReturnWorkflow } from "@/components/ReturnWorkflow";
import { VoidWorkflow } from "@/components/VoidWorkflow";
import {
  VoiceCapture,
  type AudioInterpretationResult,
} from "@/components/VoiceCapture";
import type { ApprovalDraft, InterpretedDraft } from "@/lib/types";

type View = "create" | "return" | "history" | "void";

function getLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function Home() {
  const [view, setView] = useState<View>("create");
  const [draft, setDraft] = useState<ApprovalDraft | null>(null);
  const [loadedMemoNumber, setLoadedMemoNumber] = useState("");
  const [interpretationMessage, setInterpretationMessage] = useState("");
  const [interpretationWarnings, setInterpretationWarnings] = useState<string[]>([]);

  function applyInterpretedDraft(interpreted: InterpretedDraft) {
    const interpretedItems = interpreted.items.map((item) => ({
      id: crypto.randomUUID(),
      size: item.size,
      description: item.descriptionQuery,
      carats: item.carats,
      askingPrice: item.askingPrice ?? 0,
      remarks: item.remarks ?? "",
    }));

    setLoadedMemoNumber("");
    setDraft({
      recipientName: interpreted.recipientName || "",
      recipientType: interpreted.recipientType || "Other",
      through: interpreted.through || "",
      date: interpreted.date || getLocalDate(),
      items: interpretedItems,
    });
  }

  async function interpretText(text: string) {
    setInterpretationMessage("");
    setInterpretationWarnings([]);

    const response = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: text }),
    });

    const data = (await response.json()) as {
      draft?: InterpretedDraft;
      warnings?: string[];
      error?: string;
    };

    if (!response.ok || !data.draft) {
      throw new Error(data.error || "The instruction could not be interpreted.");
    }

    applyInterpretedDraft(data.draft);
    setInterpretationWarnings(data.warnings || []);
    setInterpretationMessage(
      "The instruction was matched against CUT. MASTER and MEMO terminology. Verify every field before updating Google Sheets.",
    );
  }

  async function interpretAudio(
    audio: Blob,
    language: string,
  ): Promise<AudioInterpretationResult> {
    setInterpretationMessage("");
    setInterpretationWarnings([]);

    const form = new FormData();
    form.append("audio", audio, "approval-note.wav");
    form.append("language", language);

    const response = await fetch("/api/interpret-audio", {
      method: "POST",
      body: form,
    });

    const data = (await response.json()) as {
      transcript?: string;
      detectedLanguage?: string;
      warnings?: string[];
      draft?: InterpretedDraft;
      error?: string;
    };

    if (!response.ok || !data.draft || !data.transcript) {
      throw new Error(
        data.error || "The recorded instruction could not be interpreted.",
      );
    }

    applyInterpretedDraft(data.draft);
    setInterpretationWarnings(data.warnings || []);
    setInterpretationMessage(
      `The complete audio was processed${data.detectedLanguage ? ` as ${data.detectedLanguage}` : ""} and matched against the live Google Sheet terminology.`,
    );

    return {
      transcript: data.transcript,
      warnings: data.warnings || [],
    };
  }

  function loadHistoryDraft(historyDraft: ApprovalDraft, memoNumber: string) {
    setDraft(historyDraft);
    setLoadedMemoNumber(memoNumber);
    setInterpretationMessage(`Historical memo ${memoNumber} was loaded. Download it again, or edit any field to create a corrected replacement draft.`);
    setInterpretationWarnings([]);
    setView("create");
    window.setTimeout(() => window.scrollTo({ top: 520, behavior: "smooth" }), 50);
  }

  function startNewMemo() {
    setDraft(null);
    setLoadedMemoNumber("");
    setInterpretationMessage("");
    setInterpretationWarnings([]);
    setView("create");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark">K</div>
            <div>
              <strong>Kiran Voice Documents</strong>
              <span>Google Sheets memorandum operations</span>
            </div>
          </div>
          <div className="topbar-note">
            Google Sheets is the business record. Audio and PDFs are not stored.
          </div>
        </div>
      </header>

      <div className="container">
        <section className="hero panel">
          <div>
            <div className="eyebrow">Daily operations</div>
            <h1>Create, return, search and correct memorandums safely.</h1>
            <p className="lead">
              Names and terminology come from CUT. MASTER and MEMO. Confirmed
              transactions update Google Sheets, while duplicate protection and
              the hidden audit log preserve the operational history.
            </p>
            <div className="status-row">
              <span className="pill"><FileSpreadsheet size={15} /> Live Google Sheet</span>
              <span className="pill"><Mic2 size={15} /> Multilingual audio</span>
              <span className="pill"><ShieldCheck size={15} /> Duplicate protection</span>
              <span className="pill"><RotateCcw size={15} /> Return workflow</span>
              <span className="pill"><History size={15} /> Search & regenerate</span>
              <span className="pill"><FileCheck2 size={15} /> Temporary PDF</span>
            </div>
          </div>
          <div className="constraint-card">
            <strong>Two items remain intentionally unchanged</strong>
            <p>
              The final official numbering rule and pixel-identical PDF template
              will be added later when you provide those business decisions.
            </p>
          </div>
        </section>

        <section className="panel connection-panel">
          <div>
            <div className="eyebrow">System status</div>
            <h2>Google Sheet connection</h2>
          </div>
          <GoogleSheetStatus />
        </section>

        <nav className="operation-tabs" aria-label="Memorandum operations">
          <button type="button" className={view === "create" ? "active" : ""} onClick={() => setView("create")}>
            <Mic2 size={18} /> Create Memo
          </button>
          <button type="button" className={view === "return" ? "active" : ""} onClick={() => setView("return")}>
            <RotateCcw size={18} /> Mark Returned
          </button>
          <button type="button" className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
            <History size={18} /> History
          </button>
          <button type="button" className={view === "void" ? "active" : ""} onClick={() => setView("void")}>
            <Ban size={18} /> Void / Correct
          </button>
        </nav>

        {view === "create" && (
          <>
            <section className="panel document-section">
              <div className="step-number">1</div>
              <div className="eyebrow">Voice request</div>
              <div className="section-title-row">
                <div>
                  <h2>Speak the approval note</h2>
                  <p className="muted">Use Gujarati, Hindi, English or mixed language.</p>
                </div>
                {draft && (
                  <button type="button" className="btn btn-secondary" onClick={startNewMemo}>
                    Start new memo
                  </button>
                )}
              </div>
              <VoiceCapture
                onInterpretText={interpretText}
                onInterpretAudio={interpretAudio}
              />
              {interpretationMessage && (
                <div className="notice success top-gap">{interpretationMessage}</div>
              )}
              {interpretationWarnings.length > 0 && (
                <div className="notice warning top-gap">
                  <strong>Check these details:</strong>
                  <ul>
                    {interpretationWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              )}
            </section>

            {draft ? (
              <section className="panel document-section">
                <div className="step-number">2</div>
                <div className="eyebrow">Validation and generation</div>
                <h2>Review before updating Google Sheets</h2>
                <p className="muted section-intro">
                  Product terminology is validated again on the server. Nothing is
                  recorded until both confirmation checkboxes are selected.
                </p>
                <ApprovalNoteEditor
                  draft={draft}
                  onChange={setDraft}
                  initialSerialNumber={loadedMemoNumber}
                />
              </section>
            ) : (
              <section className="panel document-section empty-state">
                <div className="step-number">2</div>
                <div className="eyebrow">Validation and generation</div>
                <h2>Memorandum preview</h2>
                <p className="muted">
                  No memorandum has been created yet. Record or type the instruction;
                  the preview and product rows will appear after processing.
                </p>
              </section>
            )}
          </>
        )}

        {view === "return" && (
          <section className="panel document-section">
            <div className="eyebrow">Received / returned goods</div>
            <h2>Mark a memorandum returned</h2>
            <p className="muted section-intro">
              This updates SHEET1 return date, confirmation person, confirmation date
              and time. App-created memorandums also update MEMO return status.
            </p>
            <ReturnWorkflow />
          </section>
        )}

        {view === "history" && (
          <section className="panel document-section">
            <div className="eyebrow">Audit history</div>
            <h2>Search and regenerate documents</h2>
            <p className="muted section-intro">
              Search app-created memorandums, view return/void status and reload the
              saved structured data for PDF regeneration or a corrected replacement.
            </p>
            <DocumentHistory onLoad={loadHistoryDraft} />
          </section>
        )}

        {view === "void" && (
          <section className="panel document-section">
            <div className="eyebrow">Non-destructive correction</div>
            <h2>Void an incorrect memorandum</h2>
            <p className="muted section-intro">
              Incorrect records are never deleted. Void the original, then load it
              from History and edit it to create a new replacement memorandum.
            </p>
            <VoidWorkflow />
          </section>
        )}
      </div>
    </main>
  );
}
