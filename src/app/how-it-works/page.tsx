import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  FileCheck2,
  History,
  Mic,
  RotateCcw,
  Sheet,
  Sparkles,
} from "lucide-react";

const steps = [
  {
    icon: Mic,
    title: "1. Speak or type the memorandum",
    text: "Choose the speaking language, press the microphone, speak the complete instruction, and press stop. The recording appears in the conversation like a voice message.",
  },
  {
    icon: Sparkles,
    title: "2. Let Kiran Assistant process it",
    text: "The assistant transcribes the audio, identifies the recipient, matches names and diamond terminology against the live Google Sheet, and prepares the memorandum draft.",
  },
  {
    icon: FileCheck2,
    title: "3. Review every field",
    text: "Check the recipient, recipient type, through/broker, date, shape, size, quality, colour, carats, asking price and remarks. Correct anything that is unclear before saving.",
  },
  {
    icon: Sheet,
    title: "4. Update Google Sheets and download",
    text: "After confirmation, the system records the transaction in MEMO and SHEET1. The PDF downloads only after Google Sheets confirms the update.",
  },
];

export default function HowItWorksPage() {
  return (
    <main className="help-page">
      <header className="help-header">
        <a href="/" className="help-back-link">
          <ArrowLeft size={18} />
          Back to Kiran Assistant
        </a>

        <div className="help-brand">
          <img src="/kiran-logo.png" alt="Kiran" />
          <div>
            <strong>Kiran AI Memorandum Assistant</strong>
            <span>User guide</span>
          </div>
        </div>
      </header>

      <section className="help-hero">
        <span className="help-kicker">How this system works</span>
        <h1>Create and manage memorandums using voice</h1>
        <p>
          This guide explains the correct workflow for creating a memorandum,
          recording returned goods, searching history and correcting an error.
        </p>
      </section>

      <section className="help-steps">
        {steps.map(({ icon: Icon, title, text }) => (
          <article className="help-step-card" key={title}>
            <div className="help-step-icon">
              <Icon size={24} />
            </div>
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="help-section">
        <div className="help-section-heading">
          <Mic size={23} />
          <div>
            <h2>How to speak for the best accuracy</h2>
            <p>Speak slowly and pause briefly between fields.</p>
          </div>
        </div>

        <div className="help-example">
          <strong>Recommended example</strong>
          <p>
            “Create an approval note for Hitesh S Sanghavi. Recipient type
            broker. First item: PE, VVS-1 FG. Size one by four. Carats 37 point
            37. Asking price 45,000. Second item: MQ, VS-1 GH. Size one by ten.
            Carats 25 point 42. Asking price 48,500.”
          </p>
        </div>

        <div className="help-check-grid">
          {[
            "Say each name clearly.",
            "Say decimal digits separately when needed.",
            "State the asking price for every item.",
            "Pause between different product rows.",
            "Review warnings before confirming.",
            "Never save when a number looks uncertain.",
          ].map((item) => (
            <div className="help-check" key={item}>
              <CheckCircle2 size={18} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="help-operation-grid">
        <article className="help-operation-card">
          <RotateCcw size={24} />
          <h2>Mark returned</h2>
          <p>
            Open <strong>Mark returned</strong> from the left menu. Enter or
            speak the memorandum reference, return date and confirmation
            person. Verify the linked rows before updating Google Sheets.
          </p>
        </article>

        <article className="help-operation-card">
          <History size={24} />
          <h2>History</h2>
          <p>
            Search previous memorandums by number or recipient. You can reload
            an old memorandum for PDF regeneration or use it as the starting
            point for a corrected replacement.
          </p>
        </article>

        <article className="help-operation-card">
          <Ban size={24} />
          <h2>Void / Correct</h2>
          <p>
            Incorrect memorandums are not deleted. Void the original with a
            reason, then create a replacement so the audit history remains
            complete.
          </p>
        </article>
      </section>

      <section className="help-warning">
        <strong>Important</strong>
        <p>
          AI can mishear names, decimal values or prices. The person using the
          system is responsible for checking the complete memorandum before
          updating Google Sheets.
        </p>
      </section>
    </main>
  );
}
