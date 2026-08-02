"use client";

import { ArrowUp, Mic, Square, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

const languages = [
  { value: "auto-mixed", label: "Automatic / Mixed language" },
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
};

type AudioContextConstructor = typeof AudioContext;

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
}: VoiceCaptureProps) {
  const [transcript, setTranscript] = useState("");
  const [language, setLanguage] = useState("auto-mixed");
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
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

      await onInterpretAudio(wav, language);
      setTranscript("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The recorded instruction could not be processed.",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function interpretTypedText() {
    if (!transcript.trim()) return;

    setProcessing(true);
    setError("");

    try {
      await onInterpretText(transcript.trim());
      setTranscript("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The instruction could not be interpreted.",
      );
    } finally {
      setProcessing(false);
    }
  }

  function clearAll() {
    setTranscript("");
    setError("");
  }

  return (
    <div className="assistant-composer">
      <div className="composer-header">
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
        <span className={`composer-status ${recording ? "recording" : processing ? "processing" : ""}`}>
          {recording
            ? `Recording ${seconds}s`
            : processing
              ? "Processing audio…"
              : "Ready"}
        </span>
      </div>

      {!supported && (
        <div className="notice error composer-notice">
          Use the latest Google Chrome and allow microphone access. Typed instructions still work.
        </div>
      )}

      {error && <div className="notice error composer-notice">{error}</div>}


      <textarea
        className="transcript assistant-input"
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!processing && !recording && transcript.trim()) {
              void interpretTypedText();
            }
          }
        }}
        placeholder="Message Kiran Assistant…"
        disabled={recording}
        rows={3}
      />

      <div className="composer-toolbar">
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

        <span className="composer-help">
          {recording
            ? "Speak naturally, then tap stop"
            : "Gujarati · Hindi · English · Mixed"}
        </span>

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
            aria-label="Interpret instruction"
          >
            <ArrowUp size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}
