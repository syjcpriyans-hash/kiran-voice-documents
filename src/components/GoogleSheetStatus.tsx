"use client";

import { CheckCircle2, FileSpreadsheet, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type StatusResponse = {
  connected?: boolean;
  spreadsheetTitle?: string;
  sheets?: string[];
  missingSheets?: string[];
  error?: string;
};

export function GoogleSheetStatus() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const checkConnection = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/google-sheet/status", {
        cache: "no-store",
      });
      const data = (await response.json()) as StatusResponse;
      setStatus(data);
    } catch {
      setStatus({
        connected: false,
        error: "The website could not check the Google Sheet connection.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  return (
    <div className="voice-card">
      <div className="upload-icon">
        <FileSpreadsheet size={34} />
      </div>

      <h3>
        {loading
          ? "Checking Google Sheet…"
          : status?.connected
            ? "Google Sheet connected"
            : "Google Sheet needs attention"}
      </h3>

      {status?.connected ? (
        <div className="notice success">
          <CheckCircle2 size={18} />
          <div>
            <strong>{status.spreadsheetTitle}</strong>
            <div>
              The memorandum and tracking worksheets will be updated together before the document is downloaded.
            </div>
          </div>
        </div>
      ) : (
        !loading && (
          <div className="notice error">
            <TriangleAlert size={18} />
            <div>
              <strong>Connection requires attention</strong>
              <div>{status?.error || "Required worksheets are missing."}</div>
              {status?.missingSheets?.length ? (
                <div>Missing: {status.missingSheets.join(", ")}</div>
              ) : null}
            </div>
          </div>
        )
      )}

      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => void checkConnection()}
        disabled={loading}
      >
        <RefreshCw size={17} />
        {loading ? "Checking…" : "Recheck connection"}
      </button>
    </div>
  );
}
