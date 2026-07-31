"use client";

import { Mic, Square, WandSparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";

const languages = [
  { value: "en-IN", label: "Indian English" },
  { value: "gu-IN", label: "Gujarati" },
  { value: "hi-IN", label: "Hindi" },
];

type SpeechRecognitionResultLike = {
  0: { transcript: string };
  isFinal: boolean;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type RecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}

export function VoiceCapture({ onInterpret }: { onInterpret: (text: string) => Promise<void> }) {
  const [transcript, setTranscript] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const supported = useMemo(
    () => typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    [],
  );

  function startListening() {
    setError("");
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = language;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      let value = "";
      for (let index = 0; index < event.results.length; index += 1) {
        value += `${event.results[index][0].transcript} `;
      }
      setTranscript(value.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setError("The microphone could not capture the speech. Try again or type the instruction below.");
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function interpret() {
    if (!transcript.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onInterpret(transcript.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The instruction could not be interpreted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="voice-card">
      <div className="field compact-field">
        <label htmlFor="speech-language">Speaking language</label>
        <select id="speech-language" value={language} onChange={(event) => setLanguage(event.target.value)}>
          {languages.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className={`mic-button ${listening ? "listening" : ""}`}
        onClick={listening ? stopListening : startListening}
        aria-label={listening ? "Stop listening" : "Start listening"}
        disabled={!supported}
      >
        {listening ? <Square size={32} /> : <Mic size={40} />}
      </button>

      <h3>{listening ? "Listening…" : "Press the microphone and speak"}</h3>
      <p className="muted center-text">Names come directly from the spoken instruction. They do not need to be saved beforehand.</p>

      {!supported && <div className="notice error">Use Google Chrome for microphone input. Typed instructions still work.</div>}
      {error && <div className="notice error">{error}</div>}

      <textarea
        className="transcript"
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        placeholder="Example: Create an approval note for Hitesh Sanghavi broker..."
      />

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={interpret} disabled={busy || !transcript.trim()}>
          <WandSparkles size={18} /> {busy ? "Interpreting…" : "Interpret instruction"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setTranscript("")} disabled={busy}>
          Clear
        </button>
      </div>
    </div>
  );
}
