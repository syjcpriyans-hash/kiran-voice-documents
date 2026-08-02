"use client";

import {
  Ban,
  BookOpen,
  History as HistoryIcon,
  Menu,
  Mic2,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApprovalNoteEditor } from "@/components/ApprovalNoteEditor";
import { DocumentHistory } from "@/components/DocumentHistory";
import { GoogleSheetStatus } from "@/components/GoogleSheetStatus";
import {
  ReturnWorkflow,
  type ReturnDetails,
} from "@/components/ReturnWorkflow";
import { VoidWorkflow } from "@/components/VoidWorkflow";
import {
  VoiceCapture,
  type AudioInterpretationResult,
} from "@/components/VoiceCapture";
import type { ApprovalDraft, InterpretedDraft } from "@/lib/types";

type View = "assistant" | "history" | "void";
type AssistantAction = "create_memorandum" | "mark_returned" | null;

function formatAudioDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

const voiceWaveform = [
  8, 14, 10, 19, 13, 24, 17, 11, 21, 15, 26, 18, 12, 23, 16, 9, 20, 14,
  25, 17,
];

function getLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function Home() {
  const [view, setView] = useState<View>("assistant");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [action, setAction] = useState<AssistantAction>(null);
  const [draft, setDraft] = useState<ApprovalDraft | null>(null);
  const [returnDetails, setReturnDetails] = useState<ReturnDetails | null>(null);
  const [loadedMemoNumber, setLoadedMemoNumber] = useState("");
  const [interpretationMessage, setInterpretationMessage] = useState("");
  const [interpretationWarnings, setInterpretationWarnings] = useState<string[]>([]);
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [lastAudioDuration, setLastAudioDuration] = useState<number | null>(null);
  const [audioProcessing, setAudioProcessing] = useState(false);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
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
    setReturnDetails(null);
    setAction("create_memorandum");
    setDraft({
      recipientName: interpreted.recipientName || "",
      recipientType: interpreted.recipientType || "Other",
      through: interpreted.through || "",
      date: interpreted.date || getLocalDate(),
      items: interpretedItems,
    });
  }

  function applyReturnDetails(details: ReturnDetails) {
    setDraft(null);
    setLoadedMemoNumber("");
    setAction("mark_returned");
    setReturnDetails(details);
  }

  async function interpretText(text: string) {
    const cleanText = text.trim();
    setLastUserMessage(cleanText);
    setLastAudioDuration(null);
    setAudioProcessing(false);
    setInterpretationMessage("");
    setInterpretationWarnings([]);
    setDraft(null);
    setReturnDetails(null);
    setAction(null);

    const response = await fetch("/api/assistant/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: cleanText }),
    });

    const data = (await response.json()) as {
      action?: "create_memorandum" | "mark_returned";
      draft?: InterpretedDraft;
      details?: ReturnDetails;
      warnings?: string[];
      error?: string;
    };

    if (!response.ok || !data.action) {
      throw new Error(data.error || "The instruction could not be interpreted.");
    }

    setInterpretationWarnings(data.warnings || []);

    if (data.action === "create_memorandum" && data.draft) {
      applyInterpretedDraft(data.draft);
      setInterpretationMessage(
        "I prepared the memorandum draft below. Please review every field before updating Google Sheets.",
      );
      return;
    }

    if (data.action === "mark_returned" && data.details) {
      applyReturnDetails(data.details);
      setInterpretationMessage(
        "I prepared the return details below. Find and verify the linked memorandum before updating Google Sheets.",
      );
      return;
    }

    throw new Error("The instruction could not be interpreted.");
  }

  async function interpretAudio(
    audio: Blob,
    language: string,
  ): Promise<AudioInterpretationResult> {
    setInterpretationMessage("");
    setInterpretationWarnings([]);
    setDraft(null);
    setReturnDetails(null);
    setAction(null);

    const form = new FormData();
    form.append("audio", audio, "assistant-instruction.wav");
    form.append("language", language);

    const response = await fetch("/api/assistant/interpret-audio", {
      method: "POST",
      body: form,
    });

    const data = (await response.json()) as {
      action?: "create_memorandum" | "mark_returned";
      transcript?: string;
      draft?: InterpretedDraft;
      details?: ReturnDetails;
      warnings?: string[];
      error?: string;
    };

    if (!response.ok || !data.action || !data.transcript) {
      throw new Error(
        data.error || "The recorded instruction could not be interpreted.",
      );
    }

    setLastUserMessage("");
    setInterpretationWarnings(data.warnings || []);

    if (data.action === "create_memorandum" && data.draft) {
      applyInterpretedDraft(data.draft);
      setInterpretationMessage(
        "I processed the complete audio and prepared the memorandum draft below. Please review every field before updating Google Sheets.",
      );
    } else if (data.action === "mark_returned" && data.details) {
      applyReturnDetails(data.details);
      setInterpretationMessage(
        "I processed the complete audio and prepared the return details below. Find and verify the linked memorandum before updating Google Sheets.",
      );
    } else {
      throw new Error("The recorded instruction could not be interpreted.");
    }

    return {
      transcript: data.transcript,
      warnings: data.warnings || [],
    };
  }

  function handleAudioSubmitted(details: { durationSeconds: number }) {
    setLastAudioDuration(details.durationSeconds);
    setAudioProcessing(true);
    setLastUserMessage("");
    setDraft(null);
    setReturnDetails(null);
    setAction(null);
    setLoadedMemoNumber("");
    setInterpretationMessage("");
    setInterpretationWarnings([]);
  }

  function handleAudioFinished() {
    setAudioProcessing(false);
  }

  function openAssistant() {
    setView("assistant");
    setSidebarOpen(false);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 20);
  }

  function openTool(nextView: Exclude<View, "assistant">) {
    setView(nextView);
    setSidebarOpen(false);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 20);
  }

  function loadHistoryDraft(historyDraft: ApprovalDraft, memoNumber: string) {
    setDraft(historyDraft);
    setReturnDetails(null);
    setAction("create_memorandum");
    setLoadedMemoNumber(memoNumber);
    setInterpretationMessage(
      `Historical memorandum ${memoNumber} has been loaded. Download it again, or edit any field to create a corrected replacement.`,
    );
    setInterpretationWarnings([]);
    setLastUserMessage("");
    setLastAudioDuration(null);
    setAudioProcessing(false);
    setView("assistant");
    setSidebarOpen(false);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  }

  function startNewConversation() {
    setDraft(null);
    setReturnDetails(null);
    setAction(null);
    setLoadedMemoNumber("");
    setInterpretationMessage("");
    setInterpretationWarnings([]);
    setLastUserMessage("");
    setLastAudioDuration(null);
    setAudioProcessing(false);
    openAssistant();
  }

  const contentTitle =
    view === "history"
      ? "History"
      : view === "void"
        ? "Void or correct"
        : "Kiran Assistant";

  const showWelcome =
    !draft &&
    !returnDetails &&
    !interpretationMessage &&
    !lastUserMessage &&
    lastAudioDuration === null &&
    !audioProcessing;

  return (
    <div className="chat-workspace">
      <button
        type="button"
        className={`chat-sidebar-backdrop ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-label="Close navigation"
        tabIndex={sidebarOpen ? 0 : -1}
      />

      <aside
        className={`chat-sidebar ${sidebarOpen ? "open" : ""}`}
        aria-label="Kiran Assistant navigation"
      >
        <div className="chat-sidebar-brand">
          <button
            type="button"
            className="chat-brand-button"
            onClick={startNewConversation}
            aria-label="Open Kiran Assistant"
          >
            <img src="/kiran-logo.png" alt="Kiran" />
            <span>
              <strong>Kiran Assistant</strong>
              <small>Memorandum operations</small>
            </span>
          </button>

          <button
            type="button"
            className="chat-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <button
          type="button"
          className="sidebar-new-memo"
          onClick={startNewConversation}
        >
          <Plus size={18} />
          <span>New conversation</span>
        </button>

        <nav className="sidebar-navigation">
          <button
            type="button"
            className={view === "history" ? "active" : ""}
            onClick={() => openTool("history")}
          >
            <HistoryIcon size={19} />
            <span>History</span>
          </button>

          <button
            type="button"
            className={view === "void" ? "active" : ""}
            onClick={() => openTool("void")}
          >
            <Ban size={19} />
            <span>Void or correct</span>
          </button>

          <a
            href="/how-it-works"
            target="_blank"
            rel="noreferrer"
            className="sidebar-help-link"
          >
            <BookOpen size={19} />
            <span>How this system works</span>
          </a>
        </nav>

        <div className="sidebar-footer">
          <GoogleSheetStatus />
        </div>
      </aside>

      <section className="chat-content">
        <header className="mobile-chat-header">
          <button
            type="button"
            className="mobile-menu-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={22} />
          </button>

          <div className="mobile-chat-title">
            <img src="/kiran-logo.png" alt="" />
            <strong>{contentTitle}</strong>
          </div>

          <button
            type="button"
            className="mobile-new-button"
            onClick={startNewConversation}
            aria-label="Start a new conversation"
          >
            <Plus size={20} />
          </button>
        </header>

        <main className="chat-main">
          {view === "assistant" && (
            <section className="assistant-thread">
              {showWelcome && (
                <div className="assistant-welcome chat-welcome">
                  <h1>How can I help with today&apos;s memorandum?</h1>
                  <p>
                    Use this same conversation to create a memorandum or record
                    returned goods. Speak naturally in Gujarati, Hindi, English,
                    or a mixture of these languages. You can also type the full
                    instruction.
                  </p>
                </div>
              )}

              <div className="conversation-stream">
                {lastUserMessage && (
                  <div className="chat-message user-message">
                    <div className="user-bubble">{lastUserMessage}</div>
                  </div>
                )}

                {lastAudioDuration !== null && (
                  <div className="chat-message user-message">
                    <div className="user-bubble voice-note-bubble">
                      <span className="voice-note-icon" aria-hidden="true">
                        <Mic2 size={19} />
                      </span>
                      <span className="voice-note-content">
                        <span className="voice-note-waveform" aria-hidden="true">
                          {voiceWaveform.map((height, index) => (
                            <i key={`${height}-${index}`} style={{ height }} />
                          ))}
                        </span>
                        <span className="voice-note-meta">
                          Voice message · {formatAudioDuration(lastAudioDuration)}
                        </span>
                      </span>
                    </div>
                  </div>
                )}

                {audioProcessing && (
                  <div className="chat-message assistant-message processing-audio-message">
                    <div className="chat-avatar">K</div>
                    <div className="assistant-message-copy">
                      <strong>Kiran Assistant</strong>
                      <div className="processing-audio-copy">
                        <span>Processing audio</span>
                        <span
                          className="thinking-dots"
                          aria-label="Kiran Assistant is processing the recording"
                        >
                          <i />
                          <i />
                          <i />
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {interpretationMessage && !audioProcessing && (
                  <div className="chat-message assistant-message">
                    <div className="chat-avatar">K</div>
                    <div className="assistant-message-copy">
                      <strong>Kiran Assistant</strong>
                      <p>{interpretationMessage}</p>
                    </div>
                  </div>
                )}

                {interpretationWarnings.length > 0 && !audioProcessing && (
                  <div className="notice warning assistant-alert">
                    <strong>Please verify these details:</strong>
                    <ul>
                      {interpretationWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {action === "create_memorandum" && draft && !audioProcessing && (
                  <div className="assistant-result-card">
                    <div className="result-card-header">
                      <div>
                        <span className="result-kicker">Draft prepared</span>
                        <h2>Review before updating Google Sheets</h2>
                        <p>
                          Confirm every name, product, carat value, and price
                          before recording the transaction.
                        </p>
                      </div>

                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={startNewConversation}
                      >
                        <Plus size={17} />
                        New conversation
                      </button>
                    </div>

                    <ApprovalNoteEditor
                      draft={draft}
                      onChange={setDraft}
                      initialSerialNumber={loadedMemoNumber}
                    />
                  </div>
                )}

                {action === "mark_returned" &&
                  returnDetails &&
                  !audioProcessing && (
                    <div className="assistant-result-card">
                      <div className="result-card-header">
                        <div>
                          <span className="result-kicker">
                            Return details prepared
                          </span>
                          <h2>Review before updating Google Sheets</h2>
                          <p>
                            Find the linked memorandum and verify every return
                            detail before recording the update.
                          </p>
                        </div>
                      </div>

                      <ReturnWorkflow
                        initialDetails={returnDetails}
                        initialWarnings={[]}
                        showVoiceInput={false}
                      />
                    </div>
                  )}
              </div>

              <div className="composer-dock">
                <VoiceCapture
                  onInterpretText={interpretText}
                  onInterpretAudio={interpretAudio}
                  onAudioSubmitted={handleAudioSubmitted}
                  onAudioFinished={handleAudioFinished}
                />
                <p className="assistant-disclaimer">
                  Artificial intelligence can make mistakes. Review all names,
                  decimal values, and prices before confirming.
                </p>
              </div>
            </section>
          )}

          {view === "history" && (
            <section className="tool-page">
              <div className="tool-page-heading">
                <div className="tool-icon">
                  <HistoryIcon size={24} />
                </div>
                <div>
                  <span>Business records</span>
                  <h1>Memorandum history</h1>
                  <p>
                    Search memorandums, view return or void status, and reload
                    saved information for document regeneration or correction.
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
                <div className="tool-icon danger">
                  <Ban size={24} />
                </div>
                <div>
                  <span>Non-destructive correction</span>
                  <h1>Void or correct a memorandum</h1>
                  <p>
                    Incorrect records are never deleted. Void the original, then
                    create a corrected replacement through History.
                  </p>
                </div>
              </div>

              <div className="assistant-result-card">
                <VoidWorkflow />
              </div>
            </section>
          )}
        </main>
      </section>
    </div>
  );
}
