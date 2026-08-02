"use client";

import { FileCheck2, FileSpreadsheet, Mic2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ApprovalNoteEditor } from "@/components/ApprovalNoteEditor";
import { GoogleSheetStatus } from "@/components/GoogleSheetStatus";
import {
  VoiceCapture,
  type AudioInterpretationResult,
} from "@/components/VoiceCapture";
import type { ApprovalDraft, InterpretedDraft } from "@/lib/types";

function getLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function Home() {
  const [draft, setDraft] = useState<ApprovalDraft | null>(null);
  const [interpretationMessage, setInterpretationMessage] = useState("");

  function applyInterpretedDraft(interpreted: InterpretedDraft) {
    const interpretedItems = interpreted.items.map((item) => ({
      id: crypto.randomUUID(),
      size: item.size,
      description: item.descriptionQuery,
      carats: item.carats,
      askingPrice: item.askingPrice ?? 0,
      remarks: item.remarks ?? "",
    }));

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

    const response = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: text }),
    });

    const data = (await response.json()) as {
      mode?: "demo" | "ai";
      draft?: InterpretedDraft;
      error?: string;
    };

    if (!response.ok || !data.draft) {
      throw new Error(
        data.error || "The instruction could not be interpreted.",
      );
    }

    applyInterpretedDraft(data.draft);
    setInterpretationMessage(
      "The typed instruction was converted into document fields. Verify every name, number and product before updating Google Sheets.",
    );
  }

  async function interpretAudio(
    audio: Blob,
    language: string,
  ): Promise<AudioInterpretationResult> {
    setInterpretationMessage("");

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
    setInterpretationMessage(
      `The complete audio was processed${data.detectedLanguage ? ` as ${data.detectedLanguage}` : ""}. Verify every extracted field before updating Google Sheets.`,
    );

    return {
      transcript: data.transcript,
      warnings: data.warnings || [],
    };
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark">K</div>
            <div>
              <strong>Kiran Voice Documents</strong>
              <span>Approval-note workflow</span>
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
            <div className="eyebrow">Google Sheets workflow</div>
            <h1>
              Speak the request. Update MEMO and SHEET1. Download the document.
            </h1>
            <p className="lead">
              The application reads terminology from the connected Google Sheet.
              After confirmation, MEMO and SHEET1 are updated together in one
              atomic Google Sheets request. The PDF downloads only after Google
              confirms the write.
            </p>
            <div className="status-row">
              <span className="pill">
                <FileSpreadsheet size={15} /> Live Google Sheet
              </span>
              <span className="pill">
                <Mic2 size={15} /> Multilingual audio
              </span>
              <span className="pill">
                <ShieldCheck size={15} /> Duplicate protection
              </span>
              <span className="pill">
                <FileCheck2 size={15} /> Temporary PDF
              </span>
            </div>
          </div>
          <div className="constraint-card">
            <strong>Return date remains blank during creation</strong>
            <p>
              SENDING DATE is recorded when the memorandum is created. RETURN
              DATE, confirmation person, confirmation date and time will be
              updated later through a separate “Mark Returned” workflow.
            </p>
          </div>
        </section>

        <section className="workflow-grid">
          <article className="panel">
            <div className="step-number">1</div>
            <div className="eyebrow">Data source</div>
            <h2>Google Sheet connection</h2>
            <GoogleSheetStatus />
          </article>

          <article className="panel">
            <div className="step-number">2</div>
            <div className="eyebrow">Voice request</div>
            <h2>Speak the approval note</h2>
            <VoiceCapture
              onInterpretText={interpretText}
              onInterpretAudio={interpretAudio}
            />
            {interpretationMessage && (
              <div className="notice success top-gap">
                {interpretationMessage}
              </div>
            )}
          </article>
        </section>

        {draft ? (
          <section className="panel document-section">
            <div className="step-number">3</div>
            <div className="eyebrow">Validation and generation</div>
            <h2>Review before updating Google Sheets</h2>
            <p className="muted section-intro">
              Nothing is recorded until the recipient, descriptions, carats and
              asking prices have been checked.
            </p>
            <ApprovalNoteEditor draft={draft} onChange={setDraft} />
          </section>
        ) : (
          <section className="panel document-section">
            <div className="step-number">3</div>
            <div className="eyebrow">Validation and generation</div>
            <h2>Memorandum preview</h2>
            <p className="muted section-intro">
              No memorandum has been created yet. Record or type the instruction.
              The preview appears only after processing.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
