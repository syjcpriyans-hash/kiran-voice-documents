"use client";

import {
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type StatusResponse = {
  connected?: boolean;
  authorized?: boolean;
  mode?: "oauth" | "legacy" | "none";
  spreadsheetTitle?: string;
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
    <div className="sidebar-sheet-status">
      <div className="sidebar-sheet-status-title">
        <FileSpreadsheet size={18} />
        <span>
          {loading
            ? "Checking Google Sheet…"
            : status?.connected
              ? "Google Sheet connected"
              : "Connect Google Sheet"}
        </span>
      </div>

      {status?.connected ? (
        <div className="sidebar-sheet-connected">
          <CheckCircle2 size={16} />
          <div>
            <strong>{status.spreadsheetTitle || "Google Sheet"}</strong>
            <small>
              {status.mode === "oauth"
                ? "Connected by you"
                : "Existing connection"}
            </small>
          </div>
        </div>
      ) : !loading && status?.error ? (
        <div className="sidebar-sheet-error">
          <TriangleAlert size={15} />
          <span>{status.error}</span>
        </div>
      ) : null}

      <div className="sidebar-sheet-actions">
        <a href="/connect-sheet" className="sidebar-sheet-connect">
          <Link2 size={15} />
          {status?.connected && status.mode === "oauth"
            ? "Change sheet"
            : status?.connected
              ? "Connect your own sheet"
              : "Connect sheet"}
        </a>

        <button
          type="button"
          className="sidebar-sheet-recheck"
          onClick={() => void checkConnection()}
          disabled={loading}
          aria-label="Recheck Google Sheet connection"
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
      </div>
    </div>
  );
}
