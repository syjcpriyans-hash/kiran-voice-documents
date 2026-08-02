"use client";

import { Database, FileCheck2, FileSpreadsheet, Mic2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ApprovalNoteEditor } from "@/components/ApprovalNoteEditor";
import {
  VoiceCapture,
  type AudioInterpretationResult,
} from "@/components/VoiceCapture";
import { WorkbookUpload } from "@/components/WorkbookUpload";
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
      throw new Error(data.error || "The instruction could not be interpreted.");
    }

    applyInterpretedDraft(data.draft);
    setInterpretationMessage(
      "The typed instruction was converted into document fields. Verify every name, number and product before generation.",
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
      throw new Error(data.error || "The recorded instruction could not be interpreted.");
    }

    applyInterpretedDraft(data.draft);
    setInterpretationMessage(
      `The complete audio was processed${data.detectedLanguage ? ` as ${data.detectedLanguage}` : ""}. Verify the transcript and every extracted field before generation.`,
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
            Audio and PDFs are processed temporarily and are not stored
          </div>
        </div>
      </header>

      <div className="container">
        <section className="hero panel">
          <div>
            <div className="eyebrow">MVP foundation</div>
            <h1>Speak the request. Pull workbook data. Generate the same document.</h1>
            <p className="lead">
              The Excel workbook becomes the product-data source. Names are captured from
              speech for each document. Supabase safely records the transaction and the
              workbook receives the same serial reference.
            </p>
            <div className="status-row">
              <span className="pill"><FileSpreadsheet size={15} /> Excel import</span>
              <span className="pill"><Mic2 size={15} /> Recorded audio</span>
              <span className="pill"><Database size={15} /> Structured data</span>
              <span className="pill"><ShieldCheck size={15} /> Atomic serials</span>
              <span className="pill"><FileCheck2 size={15} /> Temporary PDF</span>
            </div>
          </div>
          <div className="constraint-card">
            <strong>Every field requires confirmation</strong>
            <p>
              Audio AI greatly improves multilingual capture, but names, decimals and prices
              must still be reviewed before an official serial number is recorded.
            </p>
          </div>
        </section>

        <section className="workflow-grid">
          <article className="panel">
            <div className="step-number">1</div>
            <div className="eyebrow">Data source</div>
            <h2>Inspect and import Excel</h2>
            <WorkbookUpload />
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
              <div className="notice success top-gap">{interpretationMessage}</div>
            )}
          </article>
        </section>

        {draft ? (
          <section className="panel document-section">
            <div className="step-number">3</div>
            <div className="eyebrow">Validation and generation</div>
            <h2>Review before recording</h2>
            <p className="muted section-intro">
              Nothing should be finalized until the transcript, recipient, descriptions,
              carats and prices have been checked.
            </p>
            <ApprovalNoteEditor draft={draft} onChange={setDraft} />
          </section>
        ) : (
          <section className="panel document-section">
            <div className="step-number">3</div>
            <div className="eyebrow">Validation and generation</div>
            <h2>Memorandum preview</h2>
            <p className="muted section-intro">
              No memorandum has been created yet. Upload the workbook, then record or type
              the approval-note instruction. The preview appears only after processing.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
