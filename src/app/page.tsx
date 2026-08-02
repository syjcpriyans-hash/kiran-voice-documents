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

function formatAudioDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

const voiceWaveform = [8, 14, 10, 19, 13, 24, 17, 11, 21, 15, 26, 18, 12, 23, 16, 9, 20, 14, 25, 17];

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState<ApprovalDraft | null>(null);
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
    setDraft({
      recipientName: interpreted.recipientName || "",
      recipientType: interpreted.recipientType || "Other",
      through: interpreted.through || "",
      date: interpreted.date || getLocalDate(),
      items: interpretedItems,
    });
  }

  async function interpretText(text: string) {
    const cleanText = text.trim();
    setLastUserMessage(cleanText);
    setLastAudioDuration(null);
    setAudioProcessing(false);
    setInterpretationMessage("");
    setInterpretationWarnings([]);

    const response = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: cleanText }),
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

    setLastUserMessage("");
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

  function handleAudioSubmitted(details: { durationSeconds: number }) {
    setLastAudioDuration(details.durationSeconds);
    setAudioProcessing(true);
    setLastUserMessage("");
    setDraft(null);
    setLoadedMemoNumber("");
    setInterpretationMessage("");
    setInterpretationWarnings([]);
  }

  function handleAudioFinished() {
    setAudioProcessing(false);
  }

  function openAssistant(nextTask: AssistantTask) {
    setView("assistant");
    setTask(nextTask);
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
    setLoadedMemoNumber(memoNumber);
    setInterpretationMessage(
      `Historical memo ${memoNumber} is ready. Download it again, or edit any field to create a corrected replacement draft.`,
    );
    setInterpretationWarnings([]);
    setLastUserMessage("");
    setLastAudioDuration(null);
    setAudioProcessing(false);
    setView("assistant");
    setTask("create");
    setSidebarOpen(false);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  }

  function startNewMemo() {
    setDraft(null);
    setLoadedMemoNumber("");
    setInterpretationMessage("");
    setInterpretationWarnings([]);
    setLastUserMessage("");
    setLastAudioDuration(null);
    setAudioProcessing(false);
    openAssistant("create");
  }

  const contentTitle =
    view === "history"
      ? "History"
      : view === "void"
        ? "Void / Correct"
        : task === "return"
          ? "Mark returned"
          : "Kiran Assistant";

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
            onClick={startNewMemo}
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

        <button type="button" className="sidebar-new-memo" onClick={startNewMemo}>
          <Plus size={18} />
          <span>New memorandum</span>
        </button>

        <nav className="sidebar-navigation">
          <button
            type="button"
            className={view === "assistant" && task === "create" ? "active" : ""}
            onClick={() => openAssistant("create")}
          >
            <MessageCircle size={19} />
            <span>Create memorandum</span>
          </button>

          <button
            type="button"
            className={view === "assistant" && task === "return" ? "active" : ""}
            onClick={() => openAssistant("return")}
          >
            <RotateCcw size={19} />
            <span>Mark returned</span>
          </button>

          <div className="sidebar-divider" />

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
            <span>Void / Correct</span>
          </button>
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
            onClick={startNewMemo}
            aria-label="Create new memorandum"
          >
            <Plus size={20} />
          </button>
        </header>

        <main className="chat-main">
          {view === "assistant" && (
            <section className="assistant-thread">
              {task === "create" ? (
                <>
                  {!draft &&
                    !interpretationMessage &&
                    !lastUserMessage &&
                    lastAudioDuration === null &&
                    !audioProcessing && (
                    <div className="assistant-welcome chat-welcome">
                      <h1>How can I help with today&apos;s memorandum?</h1>
                      <p>
                        Speak naturally in Gujarati, Hindi, English or mixed
                        language. You can also type the complete instruction.
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
                            <span className="thinking-dots" aria-label="Kiran Assistant is thinking">
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

                    {draft && !audioProcessing && (
                      <div className="assistant-result-card">
                        <div className="result-card-header">
                          <div>
                            <span className="result-kicker">Draft ready</span>
                            <h2>Review before updating Google Sheets</h2>
                            <p>
                              Confirm every name, product, carat value and price
                              before recording the transaction.
                            </p>
                          </div>

                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={startNewMemo}
                          >
                            <Plus size={17} />
                            New memo
                          </button>
                        </div>

                        <ApprovalNoteEditor
                          draft={draft}
                          onChange={setDraft}
                          initialSerialNumber={loadedMemoNumber}
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
                      AI can make mistakes. Review all names, decimals and prices
                      before confirming.
                    </p>
                  </div>
                </>
              ) : (
                <div className="standalone-tool-view">
                  <div className="tool-page-heading compact-tool-heading">
                    <div className="tool-icon">
                      <RotateCcw size={23} />
                    </div>
                    <div>
                      <span>Goods received</span>
                      <h1>Mark memorandum returned</h1>
                      <p>
                        Find the linked memorandum, verify the return date and
                        confirmation person, then update Google Sheets.
                      </p>
                    </div>
                  </div>

                  <div className="assistant-result-card return-assistant-card">
                    <ReturnWorkflow />
                  </div>
                </div>
              )}
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
                    Search memorandums, view return or void status and reload
                    saved information for PDF regeneration or correction.
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
                    Incorrect records are never deleted. Void the original,
                    then create a corrected replacement through History.
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
