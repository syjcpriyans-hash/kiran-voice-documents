"use client";

import { Database, FileCheck2, FileSpreadsheet, Mic2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ApprovalNoteEditor } from "@/components/ApprovalNoteEditor";
import { VoiceCapture } from "@/components/VoiceCapture";
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

  async function interpret(text: string) {
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

    const interpretedItems = data.draft.items.map((item) => ({
      id: crypto.randomUUID(),
      size: item.size,
      description: item.descriptionQuery,
      carats: item.carats,
      askingPrice: item.askingPrice ?? 0,
      remarks: item.remarks ?? "",
    }));

    setDraft({
      recipientName: data.draft.recipientName || "",
      recipientType: data.draft.recipientType || "Other",
      through: data.draft.through || "",
      date: data.draft.date || getLocalDate(),
      items: interpretedItems,
    });

    setInterpretationMessage(
      data.mode === "demo"
        ? "The limited demo parser was used. Please verify every field before generation."
        : "The instruction was converted into document fields. Please verify every name, description, carat and price before generation.",
    );
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
          <div className="topbar-note">PDFs are generated temporarily and are not stored</div>
        </div>
      </header>

      <div className="container">
        <section className="hero panel">
          <div>
            <div className="eyebrow">MVP foundation</div>
            <h1>Speak the request. Pull workbook data. Generate the same document.</h1>
            <p className="lead">
              The Excel workbook becomes the product-data source. Names are captured from speech for each document.
              Supabase safely records the transaction and the workbook receives the same serial reference.
            </p>
            <div className="status-row">
              <span className="pill"><FileSpreadsheet size={15} /> Excel import</span>
              <span className="pill"><Mic2 size={15} /> Voice capture</span>
              <span className="pill"><Database size={15} /> Structured data</span>
              <span className="pill"><ShieldCheck size={15} /> Atomic serials</span>
              <span className="pill"><FileCheck2 size={15} /> Temporary PDF</span>
            </div>
          </div>
          <div className="constraint-card">
            <strong>Exact format is temporarily approximated</strong>
            <p>
              A flat blank scan or original digital template will later replace the photographed reference
              and lock every coordinate precisely.
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
            <VoiceCapture onInterpret={interpret} />
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
              Nothing should be finalized until the recipient, descriptions, carats and prices have been checked.
            </p>
            <ApprovalNoteEditor draft={draft} onChange={setDraft} />
          </section>
        ) : (
          <section className="panel document-section">
            <div className="step-number">3</div>
            <div className="eyebrow">Validation and generation</div>
            <h2>Memorandum preview</h2>
            <p className="muted section-intro">
              No memorandum has been created yet. Upload the workbook, then speak or type the approval-note
              instruction. The preview and product rows will appear here only after the instruction is interpreted.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
