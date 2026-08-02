"use client";

import { RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import {
  VoiceCapture,
  type AudioInterpretationResult,
} from "@/components/VoiceCapture";
import type { MasterData, ReturnLookupResult } from "@/lib/types";

export type ReturnDetails = {
  reference: string;
  returnDate: string;
  confirmPerson: string;
};

type ReturnWorkflowProps = {
  initialDetails?: ReturnDetails | null;
  initialWarnings?: string[];
  showVoiceInput?: boolean;
};

function localDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ReturnWorkflow({
  initialDetails = null,
  initialWarnings = [],
  showVoiceInput = true,
}: ReturnWorkflowProps) {
  const [reference, setReference] = useState(initialDetails?.reference || "");
  const [returnDate, setReturnDate] = useState(
    initialDetails?.returnDate || localDate(),
  );
  const [confirmPerson, setConfirmPerson] = useState(
    initialDetails?.confirmPerson || "",
  );
  const [operators, setOperators] = useState<string[]>([]);
  const [result, setResult] = useState<ReturnLookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error" | "warning";
    text: string;
  } | null>(
    initialWarnings.length
      ? { type: "warning", text: initialWarnings.join(" ") }
      : null,
  );
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    void fetch("/api/master-data")
      .then((response) => response.json())
      .then((payload: { data?: MasterData }) =>
        setOperators(payload.data?.operators || []),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!initialDetails) return;

    setReference(initialDetails.reference);
    setReturnDate(initialDetails.returnDate || localDate());
    setConfirmPerson(initialDetails.confirmPerson);
    setResult(null);
    setConfirmed(false);
    setMessage(
      initialWarnings.length
        ? { type: "warning", text: initialWarnings.join(" ") }
        : {
            type: "success",
            text: "The return details were extracted. Find and verify the memorandum before updating Google Sheets.",
          },
    );
  }, [
    initialDetails?.reference,
    initialDetails?.returnDate,
    initialDetails?.confirmPerson,
    initialWarnings.join("|"),
  ]);

  function applyDetails(details: ReturnDetails, warnings: string[] = []) {
    setReference(details.reference);
    setReturnDate(details.returnDate || localDate());
    setConfirmPerson(details.confirmPerson);
    setResult(null);
    setConfirmed(false);
    setMessage(
      warnings.length
        ? { type: "warning", text: warnings.join(" ") }
        : {
            type: "success",
            text: "The return details were extracted. Find and verify the memorandum before updating Google Sheets.",
          },
    );
  }

  async function interpretText(instruction: string) {
    setMessage(null);
    const response = await fetch("/api/returns/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
    const data = (await response.json()) as {
      details?: ReturnDetails;
      warnings?: string[];
      error?: string;
    };
    if (!response.ok || !data.details) {
      throw new Error(
        data.error || "The return instruction could not be interpreted.",
      );
    }
    applyDetails(data.details, data.warnings || []);
  }

  async function interpretAudio(
    audio: Blob,
    language: string,
  ): Promise<AudioInterpretationResult> {
    setMessage(null);
    const form = new FormData();
    form.append("audio", audio, "return-instruction.wav");
    form.append("language", language);
    const response = await fetch("/api/returns/interpret-audio", {
      method: "POST",
      body: form,
    });
    const data = (await response.json()) as {
      transcript?: string;
      details?: ReturnDetails;
      warnings?: string[];
      error?: string;
    };
    if (!response.ok || !data.details || !data.transcript) {
      throw new Error(
        data.error || "The return audio could not be interpreted.",
      );
    }
    applyDetails(data.details, data.warnings || []);
    return { transcript: data.transcript, warnings: data.warnings || [] };
  }

  async function lookup() {
    if (!reference.trim()) return;
    setBusy(true);
    setMessage(null);
    setResult(null);
    setConfirmed(false);
    try {
      const response = await fetch(
        `/api/returns/lookup?reference=${encodeURIComponent(reference.trim())}`,
      );
      const data = (await response.json()) as {
        result?: ReturnLookupResult;
        error?: string;
      };
      if (!response.ok || !data.result) {
        throw new Error(data.error || "The memorandum was not found.");
      }
      setResult(data.result);
      if (data.result.voided) {
        setMessage({
          type: "warning",
          text: `Memorandum ${data.result.memoNumber} is voided and cannot be marked returned${
            data.result.voidReason ? `: ${data.result.voidReason}` : "."
          }`,
        });
      } else if (data.result.warning) {
        setMessage({ type: "warning", text: data.result.warning });
      } else if (data.result.alreadyReturned) {
        setMessage({
          type: "warning",
          text: `Memorandum ${data.result.memoNumber} is already marked returned.`,
        });
      }
    } catch (cause) {
      setMessage({
        type: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "The memorandum lookup failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function markReturned() {
    if (!result || !confirmed || !confirmPerson.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/returns/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          reference: result.memoNumber || reference.trim(),
          returnDate,
          confirmPerson: confirmPerson.trim(),
        }),
      });
      const data = (await response.json()) as {
        result?: ReturnLookupResult & { message?: string };
        error?: string;
      };
      if (!response.ok || !data.result) {
        throw new Error(data.error || "The return could not be recorded.");
      }
      setResult(data.result);
      setMessage({
        type: "success",
        text:
          data.result.message ||
          `Memorandum ${data.result.memoNumber} was marked returned.`,
      });
      setConfirmed(false);
    } catch (cause) {
      setMessage({
        type: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "The return update failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {showVoiceInput && (
        <VoiceCapture
          onInterpretText={interpretText}
          onInterpretAudio={interpretAudio}
        />
      )}

      <div className="field-grid top-gap">
        <div className="field field-wide">
          <label htmlFor="return-reference">
            Internal memorandum number or official tracking-sheet memorandum number
          </label>
          <input
            id="return-reference"
            value={reference}
            onChange={(event) => {
              setReference(event.target.value);
              setResult(null);
              setConfirmed(false);
            }}
            placeholder="Example: 31 or HO/PFI/2627/0046"
          />
        </div>
        <div className="field">
          <label htmlFor="return-date">Return date</label>
          <input
            id="return-date"
            type="date"
            value={returnDate}
            onChange={(event) => setReturnDate(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-person">Confirmation person</label>
          <input
            id="confirm-person"
            list="operator-names"
            value={confirmPerson}
            onChange={(event) => setConfirmPerson(event.target.value)}
          />
          <datalist id="operator-names">
            {operators.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="actions top-gap">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={lookup}
          disabled={busy || !reference.trim()}
        >
          <Search size={17} /> Find memorandum
        </button>
      </div>

      {result && (
        <div className="lookup-card top-gap">
          <div>
            <strong>Memorandum number:</strong> {result.memoNumber}
          </div>
          <div>
            <strong>Recipient:</strong> {result.recipient || "—"}
          </div>
          <div>
            <strong>Through:</strong> {result.through || "—"}
          </div>
          <div>
            <strong>Number of items:</strong> {result.itemCount}
          </div>
          <div>
            <strong>Tracking worksheet rows:</strong>{" "}
            {result.sheet1Rows.join(", ") || "No safe link"}
          </div>
          <div>
            <strong>Memorandum worksheet rows:</strong>{" "}
            {result.memoRows.join(", ") || "No safe link"}
          </div>
          <div>
            <strong>Status:</strong>{" "}
            {result.voided
              ? `Voided${result.voidReason ? ` — ${result.voidReason}` : ""}`
              : result.alreadyReturned
                ? `Returned${
                    result.returnDate ? ` on ${result.returnDate}` : ""
                  }`
                : "Outstanding"}
          </div>
        </div>
      )}

      {result &&
        !result.voided &&
        !result.alreadyReturned &&
        result.canUpdateSheet1 && (
          <label className="confirmation-check top-gap">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I checked the memorandum reference, linked rows, return date and
              confirmation person.
            </span>
          </label>
        )}

      {message && (
        <div className={`notice ${message.type} top-gap`}>{message.text}</div>
      )}

      {result &&
        !result.voided &&
        !result.alreadyReturned &&
        result.canUpdateSheet1 && (
          <button
            type="button"
            className="btn btn-success btn-large top-gap"
            onClick={markReturned}
            disabled={busy || !confirmed || !confirmPerson.trim()}
          >
            <RotateCcw size={18} />
            {busy ? "Updating Google Sheets…" : "Mark returned in Google Sheets"}
          </button>
        )}
    </div>
  );
}
