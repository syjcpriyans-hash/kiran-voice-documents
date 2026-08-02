"use client";

import {
  Ban,
  History as HistoryIcon,
  Menu,
  MessageCircle,
  Mic2,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
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

type View = "assistant" | "history" | "void";
type AssistantTask = "create" | "return";

function getLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function Home() {
  const [view, setView] = useState<View>("assistant");
  const [task, setTask] = useState<AssistantTask>("create");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<ApprovalDraft | null>(null);
  const [loadedMemoNumber, setLoadedMemoNumber] = useState("");
  const [interpretationMessage, setInterpretationMessage] = useState("");
  const [interpretationWarnings, setInterpretationWarnings] = useState<string[]>([]);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

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
      "I created the memorandum draft and matched the names and terminology against the live Google Sheet. Please review it before recording.",
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
      `I processed the complete audio${data.detectedLanguage ? ` as ${data.detectedLanguage}` : ""} and prepared the memorandum draft below.`,
    );

    return {
      transcript: data.transcript,
      warnings: data.warnings || [],
    };
  }

  function openAssistant(nextTask: AssistantTask) {
    setView("assistant");
    setTask(nextTask);
    setDrawerOpen(false);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 20);
  }

  function openTool(nextView: Exclude<View, "assistant">) {
    setView(nextView);
    setDrawerOpen(false);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 20);
  }

  function loadHistoryDraft(historyDraft: ApprovalDraft, memoNumber: string) {
    setDraft(historyDraft);
    setLoadedMemoNumber(memoNumber);
    setInterpretationMessage(
      `Historical memo ${memoNumber} is ready. Download it again, or edit any field to create a corrected replacement draft.`,
    );
    setInterpretationWarnings([]);
    setView("assistant");
    setTask("create");
    setDrawerOpen(false);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  }

  function startNewMemo() {
    setDraft(null);
    setLoadedMemoNumber("");
    setInterpretationMessage("");
    setInterpretationWarnings([]);
    openAssistant("create");
  }

  const pageTitle =
    view === "history"
      ? "Memorandum history"
      : view === "void"
        ? "Void or correct a memorandum"
        : task === "return"
          ? "Mark goods returned"
          : "Kiran AI Assistant";

  return (
    <div className="assistant-app">
      <header className="assistant-header">
        <button
          type="button"
          className="assistant-brand"
          onClick={startNewMemo}
          aria-label="Open Kiran AI Assistant"
        >
          <img src="/kiran-logo.png" alt="Kiran" />
          <span>
            <strong>{pageTitle}</strong>
            <small>Memorandum operations</small>
          </span>
        </button>

        <button
          type="button"
          className="menu-button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls="assistant-menu"
        >
          <Menu size={24} />
        </button>
      </header>

      <button
        type="button"
        className={`drawer-backdrop ${drawerOpen ? "open" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-label="Close menu"
        tabIndex={drawerOpen ? 0 : -1}
      />

      <aside
        id="assistant-menu"
        className={`assistant-drawer ${drawerOpen ? "open" : ""}`}
        aria-hidden={!drawerOpen}
      >
        <div className="drawer-header">
          <img src="/kiran-logo.png" alt="Kiran" />
          <button
            type="button"
            className="drawer-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          >
            <X size={22} />
          </button>
        </div>

        <button type="button" className="new-chat-button" onClick={startNewMemo}>
          <Plus size={19} /> New memorandum
        </button>

        <nav className="drawer-nav" aria-label="Application menu">
          <button
            type="button"
            className={view === "assistant" && task === "create" ? "active" : ""}
            onClick={() => openAssistant("create")}
          >
            <MessageCircle size={20} />
            <span>
              <strong>Create memorandum</strong>
              <small>Speak or type the details</small>
            </span>
          </button>
          <button
            type="button"
            className={view === "assistant" && task === "return" ? "active" : ""}
            onClick={() => openAssistant("return")}
          >
            <RotateCcw size={20} />
            <span>
              <strong>Mark returned</strong>
              <small>Record received goods</small>
            </span>
          </button>
          <div className="drawer-separator" />
          <button
            type="button"
            className={view === "history" ? "active" : ""}
            onClick={() => openTool("history")}
          >
            <HistoryIcon size={20} />
            <span>
              <strong>History</strong>
              <small>Search and regenerate</small>
            </span>
          </button>
          <button
            type="button"
            className={view === "void" ? "active" : ""}
            onClick={() => openTool("void")}
          >
            <Ban size={20} />
            <span>
              <strong>Void / Correct</strong>
              <small>Preserve the audit trail</small>
            </span>
          </button>
        </nav>

        <div className="drawer-system-status">
          <GoogleSheetStatus />
        </div>
      </aside>

      <main className="assistant-main">
        {view === "assistant" && (
          <section className="assistant-thread">
            <div className="task-switcher" aria-label="Choose voice task">
              <button
                type="button"
                className={task === "create" ? "active" : ""}
                onClick={() => setTask("create")}
              >
                <Mic2 size={17} /> Create memo
              </button>
              <button
                type="button"
                className={task === "return" ? "active" : ""}
                onClick={() => setTask("return")}
              >
                <RotateCcw size={17} /> Mark returned
              </button>
            </div>

            {task === "create" ? (
              <>
                {!draft && !interpretationMessage && (
                  <div className="assistant-welcome">
                    <div className="welcome-logo-wrap">
                      <img src="/kiran-logo.png" alt="Kiran" />
                    </div>
                    <h1>How can I help with today&apos;s memorandum?</h1>
                    <p>
                      Tap the microphone and speak naturally in Gujarati, Hindi,
                      English or mixed language. You can also type the instruction.
                    </p>
                    <div className="prompt-examples">
                      <span>Create an approval note for a broker</span>
                      <span>Add multiple diamond rows</span>
                      <span>Use different prices for each item</span>
                    </div>
                  </div>
                )}

                {interpretationMessage && (
                  <div className="chat-message assistant-message">
                    <div className="chat-avatar">K</div>
                    <div>
                      <strong>Kiran Assistant</strong>
                      <p>{interpretationMessage}</p>
                    </div>
                  </div>
                )}

                {interpretationWarnings.length > 0 && (
                  <div className="notice warning assistant-alert">
                    <strong>Please verify these details:</strong>
                    <ul>
                      {interpretationWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {draft && (
                  <div className="assistant-result-card">
                    <div className="result-card-header">
                      <div>
                        <span className="result-kicker">Draft ready</span>
                        <h2>Review before updating Google Sheets</h2>
                        <p>
                          Confirm every name, product, carat value and price before
                          recording the transaction.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={startNewMemo}
                      >
                        <Plus size={17} /> New memo
                      </button>
                    </div>
                    <ApprovalNoteEditor
                      draft={draft}
                      onChange={setDraft}
                      initialSerialNumber={loadedMemoNumber}
                    />
                  </div>
                )}

                <div className="composer-dock">
                  <VoiceCapture
                    onInterpretText={interpretText}
                    onInterpretAudio={interpretAudio}
                  />
                  <p className="assistant-disclaimer">
                    AI can make mistakes. Review all names, decimals and prices before
                    confirming.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="assistant-welcome compact-welcome">
                  <div className="welcome-icon"><RotateCcw size={29} /></div>
                  <h1>Which memorandum has been returned?</h1>
                  <p>
                    Speak the memorandum reference, return date and confirmation
                    person. The assistant will find the linked rows before any update.
                  </p>
                </div>
                <div className="assistant-result-card return-assistant-card">
                  <ReturnWorkflow />
                </div>
              </>
            )}
          </section>
        )}

        {view === "history" && (
          <section className="tool-page">
            <div className="tool-page-heading">
              <div className="tool-icon"><HistoryIcon size={24} /></div>
              <div>
                <span>Business records</span>
                <h1>Memorandum history</h1>
                <p>
                  Search app-created memorandums, view return or void status and
                  reload saved information for PDF regeneration or correction.
                </p>
              </div>
            </div>
            <div className="assistant-result-card">
              <DocumentHistory onLoad={loadHistoryDraft} />
            </div>
          </section>
        )}

        {view === "void" && (
          <section className="tool-page">
            <div className="tool-page-heading">
              <div className="tool-icon danger"><Ban size={24} /></div>
              <div>
                <span>Non-destructive correction</span>
                <h1>Void or correct a memorandum</h1>
                <p>
                  Incorrect records are never deleted. Void the original, then load it
                  from History and create a replacement memorandum.
                </p>
              </div>
            </div>
            <div className="assistant-result-card">
              <VoidWorkflow />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
