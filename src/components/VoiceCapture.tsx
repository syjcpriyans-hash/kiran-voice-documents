"use client";

import { ArrowUp, Mic, Square, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const languages = [
  { value: "auto-mixed", label: "Automatic or mixed language" },
  { value: "gu-IN", label: "Gujarati" },
  { value: "hi-IN", label: "Hindi" },
  { value: "en-IN", label: "Indian English" },
];

export type AudioInterpretationResult = {
  transcript: string;
  warnings: string[];
};

type VoiceCaptureProps = {
  onInterpretText: (text: string) => Promise<void>;
  onInterpretAudio: (audio: Blob, language: string) => Promise<AudioInterpretationResult>;
  onAudioSubmitted?: (details: { durationSeconds: number }) => void;
  onAudioFinished?: () => void;
};

type AudioContextConstructor = typeof AudioContext;
type ProcessingKind = "text" | "audio" | null;

declare global {
  interface Window {
    webkitAudioContext?: AudioContextConstructor;
  }
}

const MAX_RECORDING_SECONDS = 60;
const TARGET_SAMPLE_RATE = 16000;

function mergeAudioChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function downsampleAudio(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (outputSampleRate >= inputSampleRate) return input;

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  let inputOffset = 0;

  for (let outputOffset = 0; outputOffset < outputLength; outputOffset += 1) {
    const nextInputOffset = Math.round((outputOffset + 1) * ratio);
    let total = 0;
    let count = 0;

    for (let index = inputOffset; index < nextInputOffset && index < input.length; index += 1) {
      total += input[index];
      count += 1;
    }

    output[outputOffset] = count ? total / count : 0;
    inputOffset = nextInputOffset;
  }

  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  function writeText(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(value), true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function VoiceCapture({
  onInterpretText,
  onInterpretAudio,
  onAudioSubmitted,
  onAudioFinished,
}: VoiceCaptureProps) {
  const [transcript, setTranscript] = useState("");
  const [language, setLanguage] = useState("auto-mixed");
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingKind, setProcessingKind] = useState<ProcessingKind>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const supported = useMemo(
    () =>
      typeof window !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      Boolean(window.AudioContext || window.webkitAudioContext),
    [],
  );

  function clearTimers() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    if (maxTimerRef.current !== null) window.clearTimeout(maxTimerRef.current);
    timerRef.current = null;
    maxTimerRef.current = null;
  }

  function cleanAudioResources() {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());

    processorRef.current = null;
    sourceRef.current = null;
    silentGainRef.current = null;
    streamRef.current = null;
  }

  async function startRecording() {
    setError("");
    setSeconds(0);

    if (!supported) {
      setError("Audio recording is not supported in this browser. Use the latest Google Chrome.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Audio recording is unavailable.");

      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;

      chunksRef.current = [];
      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(channel));
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      streamRef.current = stream;
      sourceRef.current = source;
      processorRef.current = processor;
      silentGainRef.current = silentGain;

      setRecording(true);

      timerRef.current = window.setInterval(() => {
        setSeconds((current) => current + 1);
      }, 1000);

      maxTimerRef.current = window.setTimeout(() => {
        void stopRecording();
      }, MAX_RECORDING_SECONDS * 1000);
    } catch (cause) {
      cleanAudioResources();
      setRecording(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "The microphone could not start. Check the browser microphone permission.",
      );
    }
  }

  async function stopRecording() {
    if (!recording || processing) return;

    setRecording(false);
    setProcessing(true);
    setProcessingKind("audio");
    setError("");
    clearTimers();

    const audioContext = audioContextRef.current;
    const inputSampleRate = audioContext?.sampleRate || 48000;

    if (processorRef.current) processorRef.current.onaudioprocess = null;
    cleanAudioResources();

    try {
      if (audioContext && audioContext.state !== "closed") {
        await audioContext.close();
      }
      audioContextRef.current = null;

      const merged = mergeAudioChunks(chunksRef.current);
      chunksRef.current = [];

      if (merged.length < inputSampleRate / 2) {
        throw new Error("The recording was too short. Speak for at least one second.");
      }

      const downsampled = downsampleAudio(merged, inputSampleRate, TARGET_SAMPLE_RATE);
      const wav = encodeWav(downsampled, TARGET_SAMPLE_RATE);

      if (wav.size > 3_500_000) {
        throw new Error("The recording is too long. Keep each instruction under 60 seconds.");
      }

      onAudioSubmitted?.({ durationSeconds: Math.max(1, seconds) });
      await onInterpretAudio(wav, language);
      setTranscript("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The recorded instruction could not be processed.",
      );
    } finally {
      onAudioFinished?.();
      setProcessingKind(null);
      setProcessing(false);
    }
  }

  function resetTextareaHeight() {
    window.requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.style.height = "44px";
    });
  }

  function resizeTextarea(element: HTMLTextAreaElement) {
    element.style.height = "44px";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 44), 120)}px`;
  }

  async function interpretTypedText() {
    const instruction = transcript.trim();
    if (!instruction) return;

    setProcessing(true);
    setProcessingKind("text");
    setError("");
    setTranscript("");
    resetTextareaHeight();

    try {
      await onInterpretText(instruction);
    } catch (cause) {
      setTranscript(instruction);
      window.requestAnimationFrame(() => {
        if (textareaRef.current) resizeTextarea(textareaRef.current);
      });
      setError(
        cause instanceof Error
          ? cause.message
          : "The instruction could not be interpreted.",
      );
    } finally {
      setProcessingKind(null);
      setProcessing(false);
    }
  }

  function clearAll() {
    setTranscript("");
    setError("");
    resetTextareaHeight();
  }

  const conversationStream =
    typeof document !== "undefined"
      ? document.querySelector(".conversation-stream")
      : null;

  return (
    <>
      {processingKind === "text" &&
        conversationStream &&
        createPortal(
          <div
            className="chat-message assistant-message typed-thinking-message"
            aria-live="polite"
          >
            <div className="chat-avatar">K</div>
            <div className="assistant-message-copy">
              <strong>Kiran Assistant</strong>
              <div className="typed-thinking-copy">
                <span>Thinking</span>
                <span
                  className="thinking-dots"
                  aria-label="Kiran Assistant is thinking"
                >
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </div>
          </div>,
          conversationStream,
        )}

      <div className="assistant-composer">
      {recording && (
        <div className="composer-header composer-header-status-only">
          <span className="composer-status recording">
            Recording: {seconds} {seconds === 1 ? "second" : "seconds"}
          </span>
        </div>
      )}

      {!supported && (
        <div className="notice error composer-notice">
          Use the latest Google Chrome and allow microphone access. Typed instructions still work.
        </div>
      )}

      {error && <div className="notice error composer-notice">{error}</div>}

      <textarea
        ref={textareaRef}
        className="transcript assistant-input"
        value={transcript}
        onChange={(event) => {
          setTranscript(event.target.value);
          resizeTextarea(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!processing && !recording && transcript.trim()) {
              void interpretTypedText();
            }
          }
        }}
        placeholder="Write a message to Kiran Assistant…"
        disabled={recording || processing}
        rows={1}
      />

      <div className="composer-toolbar">
        <div className="composer-left-controls">
          <div className="composer-language">
            <label htmlFor="speech-language">Language</label>
            <select
              id="speech-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={recording || processing}
            >
              {languages.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="composer-clear"
            onClick={clearAll}
            disabled={processing || recording || !transcript}
            aria-label="Clear instruction"
          >
            <Trash2 size={17} />
            <span>Clear</span>
          </button>
        </div>

        <div className="composer-actions">
          <button
            type="button"
            className={`composer-mic ${recording ? "recording" : ""}`}
            onClick={recording ? stopRecording : startRecording}
            aria-label={recording ? "Stop recording" : "Start recording"}
            disabled={!supported || processing}
          >
            {recording ? <Square size={21} /> : <Mic size={23} />}
          </button>

          <button
            type="button"
            className="composer-send"
            onClick={interpretTypedText}
            disabled={processing || recording || !transcript.trim()}
            aria-label="Send instruction"
          >
            <ArrowUp size={22} />
          </button>
        </div>
      </div>
      </div>

      <style jsx global>{`
        .composer-dock .assistant-composer {
          border-radius: 18px;
        }

        .composer-dock .assistant-input {
          min-height: 44px !important;
          height: 44px;
          max-height: 120px !important;
          padding: 11px 15px 4px;
          line-height: 1.4;
          resize: none !important;
          overflow-y: auto;
        }

        .composer-dock .composer-toolbar {
          padding: 5px 10px 8px;
          gap: 8px;
        }

        .composer-dock .composer-mic,
        .composer-dock .composer-send {
          width: 38px;
          height: 38px;
        }

        .typed-thinking-message {
          margin-top: 2px;
          margin-bottom: 6px;
          align-items: flex-start;
        }

        .typed-thinking-copy {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 24px;
          color: #475467;
          font-size: 0.92rem;
        }

        @media (max-width: 650px) {
          .composer-dock .assistant-input {
            min-height: 42px !important;
            height: 42px;
            padding-top: 10px;
          }

          .composer-dock .composer-toolbar {
            padding: 4px 8px 7px;
          }
        }
      `}</style>
    </>
  );
}
