"use client";

import {
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type {
  InspectedSheet,
  SheetConnectionConfig,
  SheetInspection,
} from "@/lib/sheet-connection";

type GooglePickerInstance = {
  setVisible: (visible: boolean) => void;
};

type GooglePickerBuilder = {
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (appId: string) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setOrigin: (origin: string) => GooglePickerBuilder;
  addView: (view: unknown) => GooglePickerBuilder;
  setCallback: (
    callback: (data: Record<string, unknown>) => void,
  ) => GooglePickerBuilder;
  build: () => GooglePickerInstance;
};

declare global {
  interface Window {
    gapi?: {
      load: (name: string, callback: () => void) => void;
    };
    google?: {
      picker: {
        Action: { PICKED: string; CANCEL: string };
        Response: { DOCUMENTS: string };
        Document: { ID: string };
        ViewId: { DOCS: string };
        DocsView: new (viewId: string) => {
          setMimeTypes: (mimeTypes: string) => void;
        };
        PickerBuilder: new () => GooglePickerBuilder;
      };
    };
  }
}

type Status = {
  connected?: boolean;
  authorized?: boolean;
  mode?: "oauth" | "legacy" | "none";
  spreadsheetTitle?: string;
  error?: string;
};

type PickerResponse = {
  accessToken?: string;
  picker?: {
    clientId: string;
    apiKey: string;
    appId: string;
  };
  error?: string;
};

const MEMO_FIELDS = [
  ["memoLine", "Memorandum line number", true],
  ["date", "Date", true],
  ["recipient", "Recipient or customer", true],
  ["through", "Through or broker", false],
  ["shape", "Shape", true],
  ["size", "Size", true],
  ["quality", "Quality or quality and colour", true],
  ["color", "Separate colour column", false],
  ["carats", "Carats", true],
  ["askingPrice", "Asking price", true],
  ["remarks", "Remarks", false],
  ["status", "Status", false],
] as const;

const TRACKING_FIELDS = [
  ["sentDate", "Sending date", true],
  ["returnDate", "Return date", true],
  ["memoNumber", "Official memorandum number", false],
  ["customer", "Customer", true],
  ["through", "Through or broker", false],
  ["shape", "Shape", true],
  ["size", "Size", true],
  ["color", "Colour", false],
  ["quality", "Quality or quality and colour", true],
  ["carats", "Carats", true],
  ["askingPrice", "Asking price", true],
  ["remarks", "Remarks", false],
  ["confirmPerson", "Confirmation person", false],
  ["confirmDate", "Confirmation date", false],
  ["confirmTime", "Confirmation time", false],
] as const;

const MASTER_FIELDS = [
  ["broker", "Broker names"],
  ["party", "Customer or party names"],
  ["operator", "Confirmation-person names"],
] as const;

function loadPickerScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.gapi) {
      window.gapi.load("picker", resolve);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-kiran-google-picker="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => {
        window.gapi?.load("picker", resolve);
      });
      existing.addEventListener("error", () =>
        reject(new Error("Google Picker could not load.")),
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.kiranGooglePicker = "true";
    script.onload = () => {
      if (!window.gapi) {
        reject(new Error("Google Picker did not initialize."));
        return;
      }
      window.gapi.load("picker", resolve);
    };
    script.onerror = () =>
      reject(new Error("Google Picker could not load."));
    document.head.appendChild(script);
  });
}

function findSheet(
  inspection: SheetInspection,
  sheetId: number | undefined,
): InspectedSheet | undefined {
  return inspection.sheets.find((sheet) => sheet.sheetId === sheetId);
}

function cloneConfig(config: SheetConnectionConfig): SheetConnectionConfig {
  return JSON.parse(JSON.stringify(config)) as SheetConnectionConfig;
}

export default function ConnectSheetPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [inspection, setInspection] = useState<SheetInspection | null>(null);
  const [mapping, setMapping] = useState<SheetConnectionConfig | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError) setError(urlError);

    void fetch("/api/google-sheet/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: Status) => setStatus(data))
      .catch(() =>
        setStatus({
          connected: false,
          error: "The Google connection status could not be loaded.",
        }),
      );
  }, []);

  const memoSheet = useMemo(
    () =>
      inspection && mapping
        ? findSheet(inspection, mapping.memo.sheetId)
        : undefined,
    [inspection, mapping],
  );
  const trackingSheet = useMemo(
    () =>
      inspection && mapping
        ? findSheet(inspection, mapping.tracking.sheetId)
        : undefined,
    [inspection, mapping],
  );
  const masterSheet = useMemo(
    () =>
      inspection && mapping?.master
        ? findSheet(inspection, mapping.master.sheetId)
        : undefined,
    [inspection, mapping],
  );

  function startGoogleAuthorization() {
    window.location.href = "/api/google-connect/start?returnTo=/connect-sheet";
  }

  async function chooseGoogleSheet() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const tokenResponse = await fetch("/api/google-connect/access-token", {
        method: "POST",
        cache: "no-store",
      });
      const tokenData = (await tokenResponse.json()) as PickerResponse;

      if (!tokenResponse.ok || !tokenData.accessToken || !tokenData.picker) {
        setStatus((current: Status | null) => ({
          ...(current || {}),
          connected: false,
          authorized: false,
        }));
        throw new Error(
          tokenData.error || "Connect your Google account first.",
        );
      }

      await loadPickerScript();

      if (!window.google?.picker) {
        throw new Error("Google Picker is unavailable.");
      }

      const pickerApi = window.google.picker;
      const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS);
      view.setMimeTypes("application/vnd.google-apps.spreadsheet");

      const picker = new pickerApi.PickerBuilder()
        .setDeveloperKey(tokenData.picker.apiKey)
        .setAppId(tokenData.picker.appId)
        .setOAuthToken(tokenData.accessToken)
        .setOrigin(window.location.origin)
        .addView(view)
        .setCallback((data: Record<string, unknown>) => {
          const action = data.action;
          if (action !== pickerApi.Action.PICKED) {
            setBusy(false);
            return;
          }

          const documents = data[
            pickerApi.Response.DOCUMENTS
          ] as Array<Record<string, unknown>> | undefined;
          const selected = documents?.[0];
          const spreadsheetId = selected?.[
            pickerApi.Document.ID
          ] as string | undefined;

          if (!spreadsheetId) {
            setBusy(false);
            setError("Google did not return a spreadsheet identifier.");
            return;
          }

          void analyzeSelection(spreadsheetId);
        })
        .build();

      picker.setVisible(true);
    } catch (cause) {
      setBusy(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "Google Sheet selection failed.",
      );
    }
  }

  async function analyzeSelection(spreadsheetId: string) {
    setBusy(true);
    setError("");
    setMessage("Checking the selected spreadsheet…");

    try {
      const response = await fetch("/api/google-connect/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId }),
      });
      const data = (await response.json()) as {
        connected?: boolean;
        spreadsheetTitle?: string;
        needsReview?: boolean;
        inspection?: SheetInspection;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || "The selected spreadsheet could not be connected.",
        );
      }

      if (data.connected) {
        setMessage(`${data.spreadsheetTitle || "Google Sheet"} is connected.`);
        setTimeout(() => {
          window.location.href = "/";
        }, 900);
        return;
      }

      if (data.needsReview && data.inspection) {
        setInspection(data.inspection);
        if (data.inspection.proposed) {
          setMapping(cloneConfig(data.inspection.proposed));
        } else {
          const visible = data.inspection.sheets.filter((sheet) => !sheet.hidden);
          const candidates = visible.length >= 2 ? visible : data.inspection.sheets;
          const memo = candidates[0];
          const tracking = candidates[1];
          if (memo && tracking) {
            setMapping({
              version: 1,
              spreadsheetId: data.inspection.spreadsheetId,
              spreadsheetTitle: data.inspection.spreadsheetTitle,
              connectedAt: new Date().toISOString(),
              memo: {
                sheetId: memo.sheetId,
                sheetName: memo.title,
                headerRow: memo.memo.headerRow,
                columns: memo.memo.columns as never,
              },
              tracking: {
                sheetId: tracking.sheetId,
                sheetName: tracking.title,
                headerRow: tracking.tracking.headerRow,
                columns: tracking.tracking.columns as never,
              },
            });
          }
        }
        setMessage(
          "Most of the spreadsheet was recognized. Confirm the worksheet mapping below.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The selected spreadsheet could not be analyzed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function chooseRoleSheet(
    role: "memo" | "tracking" | "master",
    sheetId: number | undefined,
  ) {
    if (!inspection || !mapping) return;

    if (role === "master" && sheetId === undefined) {
      setMapping({ ...mapping, master: undefined });
      return;
    }

    const sheet = inspection.sheets.find((item) => item.sheetId === sheetId);
    if (!sheet) return;
    const detection = sheet[role];

    setMapping((current: SheetConnectionConfig | null) => {
      if (!current) return current;

      if (role === "memo") {
        return {
          ...current,
          memo: {
            sheetId: sheet.sheetId,
            sheetName: sheet.title,
            headerRow: detection.headerRow,
            columns: detection.columns as never,
          },
        };
      }

      if (role === "tracking") {
        return {
          ...current,
          tracking: {
            sheetId: sheet.sheetId,
            sheetName: sheet.title,
            headerRow: detection.headerRow,
            columns: detection.columns as never,
          },
        };
      }

      return {
        ...current,
        master: {
          sheetId: sheet.sheetId,
          sheetName: sheet.title,
          headerRow: detection.headerRow,
          columns: detection.columns as never,
        },
      };
    });
  }

  function updateHeaderRow(
    role: "memo" | "tracking" | "master",
    row: number,
  ) {
    setMapping((current: SheetConnectionConfig | null) => {
      if (!current) return current;

      if (role === "memo") {
        return {
          ...current,
          memo: { ...current.memo, headerRow: row, columns: {} as typeof current.memo.columns },
        };
      }
      if (role === "tracking") {
        return {
          ...current,
          tracking: {
            ...current.tracking,
            headerRow: row,
            columns: {} as typeof current.tracking.columns,
          },
        };
      }
      if (!current.master) return current;
      return {
        ...current,
        master: { ...current.master, headerRow: row, columns: {} },
      };
    });
  }

  function updateColumn(
    role: "memo" | "tracking" | "master",
    field: string,
    value: string,
  ) {
    if (!mapping) return;

    const parsed = value === "" ? undefined : Number(value);

    setMapping((current: SheetConnectionConfig | null) => {
      if (!current) return current;

      const update = (roleValue: any) => {
        const columns = { ...roleValue.columns };
        if (parsed === undefined) delete columns[field];
        else columns[field] = parsed;
        return { ...roleValue, columns };
      };

      if (role === "memo") {
        return { ...current, memo: update(current.memo) };
      }
      if (role === "tracking") {
        return { ...current, tracking: update(current.tracking) };
      }
      if (!current.master) return current;
      return { ...current, master: update(current.master) };
    });
  }

  async function saveManualMapping() {
    if (!mapping) return;
    setBusy(true);
    setError("");
    setMessage("Saving the connection…");

    try {
      const response = await fetch("/api/google-connect/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mapping),
      });
      const data = (await response.json()) as {
        connected?: boolean;
        spreadsheetTitle?: string;
        error?: string;
      };

      if (!response.ok || !data.connected) {
        throw new Error(data.error || "The worksheet mapping is incomplete.");
      }

      setMessage(`${data.spreadsheetTitle || "Google Sheet"} is connected.`);
      setTimeout(() => {
        window.location.href = "/";
      }, 900);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The worksheet mapping could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");

    try {
      await fetch("/api/google-connect/disconnect", { method: "POST" });
      setInspection(null);
      setMapping(null);
      setStatus({ connected: false, authorized: false, mode: "none" });
      setMessage("The self-service Google connection was removed.");
    } finally {
      setBusy(false);
    }
  }

  function headerRowSelect(
    role: "memo" | "tracking" | "master",
    sheet: InspectedSheet | undefined,
    value: number,
  ) {
    if (!sheet) return null;

    const candidates = sheet.headerRows.length
      ? sheet.headerRows
      : [{ row: value, headers: sheet[role].headers }];

    return (
      <label className="mapping-header-select">
        <span>Header row</span>
        <select
          value={value}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            updateHeaderRow(role, Number(event.target.value))
          }
        >
          {candidates.map((candidate) => (
            <option key={candidate.row} value={candidate.row}>
              Row {candidate.row}: {candidate.headers
                .slice(0, 6)
                .map((header) => header.label)
                .join(" · ")}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function columnSelect(
    role: "memo" | "tracking" | "master",
    field: string,
    label: string,
    required: boolean,
    sheet: InspectedSheet | undefined,
    value: number | undefined,
  ) {
    const selectedHeaderRow =
      role === "memo"
        ? mapping?.memo.headerRow
        : role === "tracking"
          ? mapping?.tracking.headerRow
          : mapping?.master?.headerRow;
    const headers =
      sheet?.headerRows.find((candidate) => candidate.row === selectedHeaderRow)
        ?.headers || sheet?.[role].headers || [];

    return (
      <label className="mapping-field" key={`${role}-${field}`}>
        <span>
          {label}
          {required ? <strong>Required</strong> : null}
        </span>
        <select
          value={Number.isInteger(value) ? String(value) : ""}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            updateColumn(role, field, event.target.value)
          }
        >
          <option value="">
            {required ? "Choose column" : "Not used"}
          </option>
          {headers.map((header) => (
            <option key={header.index} value={header.index}>
              {header.label} — column {header.index + 1}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <main className="sheet-connect-page">
      <div className="sheet-connect-shell">
        <section className="sheet-connect-hero">
          <div className="sheet-connect-icon">
            <FileSpreadsheet size={34} />
          </div>
          <div>
            <span>Google Sheet connection</span>
            <h1>Connect your business spreadsheet</h1>
            <p>
              Sign in with Google, choose the spreadsheet, and Kiran Assistant
              will identify the memorandum, tracking, and master-data
              worksheets automatically.
            </p>
          </div>
        </section>

        {error ? (
          <div className="notice error sheet-connect-notice">
            <TriangleAlert size={18} />
            <div>{error}</div>
          </div>
        ) : null}

        {message ? (
          <div className="notice success sheet-connect-notice">
            <CheckCircle2 size={18} />
            <div>{message}</div>
          </div>
        ) : null}

        {!inspection ? (
          <section className="sheet-connect-card">
            <div className="connection-steps">
              <div className={status?.authorized ? "complete" : ""}>
                <span>1</span>
                <div>
                  <strong>Connect Google</strong>
                  <p>
                    Google asks for access only to files selected for Kiran
                    Assistant.
                  </p>
                </div>
              </div>
              <div className={status?.connected && status.mode === "oauth" ? "complete" : ""}>
                <span>2</span>
                <div>
                  <strong>Choose your spreadsheet</strong>
                  <p>
                    Select the real business Google Sheet from your Drive.
                  </p>
                </div>
              </div>
              <div className={status?.connected && status.mode === "oauth" ? "complete" : ""}>
                <span>3</span>
                <div>
                  <strong>Automatic setup</strong>
                  <p>
                    Kiran finds the correct worksheets, columns, and row
                    structure before saving the connection.
                  </p>
                </div>
              </div>
            </div>

            <div className="sheet-connect-actions">
              {!status?.authorized ? (
                <button
                  type="button"
                  className="btn btn-primary btn-large"
                  onClick={startGoogleAuthorization}
                  disabled={busy}
                >
                  <Link2 size={19} />
                  Connect Google
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-large"
                  onClick={() => void chooseGoogleSheet()}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="spin" size={19} />
                  ) : (
                    <FileSpreadsheet size={19} />
                  )}
                  Choose Google Sheet
                </button>
              )}

              {status?.connected && status.mode === "oauth" ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void disconnect()}
                  disabled={busy}
                >
                  Disconnect Google Sheet
                </button>
              ) : null}
            </div>

            <div className="sheet-connect-security">
              <ShieldCheck size={20} />
              <p>
                The spreadsheet does not need to be public. Keep Google Drive
                sharing restricted to the people who should use it.
              </p>
            </div>

            {status?.mode === "legacy" && status.connected ? (
              <div className="notice warning top-gap">
                Your existing Google Sheet connection is still active. You can keep using it until the new connection is completed.
              </div>
            ) : null}
          </section>
        ) : null}

        {inspection && mapping ? (
          <section className="sheet-connect-card mapping-card">
            <div className="mapping-heading">
              <div>
                <span>Connection review</span>
                <h2>{inspection.spreadsheetTitle}</h2>
                <p>
                  Kiran could not safely confirm every field automatically.
                  The selections below are already filled with the best matches.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setInspection(null);
                  setMapping(null);
                  setMessage("");
                }}
              >
                <RefreshCw size={17} />
                Choose another sheet
              </button>
            </div>

            <div className="mapping-role-card">
              <label className="mapping-sheet-select">
                <span>Memorandum records worksheet</span>
                <select
                  value={mapping.memo.sheetId}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    chooseRoleSheet("memo", Number(event.target.value))
                  }
                >
                  {inspection.sheets.map((sheet) => (
                    <option key={sheet.sheetId} value={sheet.sheetId}>
                      {sheet.title}{sheet.hidden ? " (hidden)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {headerRowSelect("memo", memoSheet, mapping.memo.headerRow)}
              <div className="mapping-grid">
                {MEMO_FIELDS.map(([field, label, required]) =>
                  columnSelect(
                    "memo",
                    field,
                    label,
                    required,
                    memoSheet,
                    (mapping.memo.columns as any)[field],
                  ),
                )}
              </div>
            </div>

            <div className="mapping-role-card">
              <label className="mapping-sheet-select">
                <span>Tracking and return worksheet</span>
                <select
                  value={mapping.tracking.sheetId}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    chooseRoleSheet("tracking", Number(event.target.value))
                  }
                >
                  {inspection.sheets.map((sheet) => (
                    <option key={sheet.sheetId} value={sheet.sheetId}>
                      {sheet.title}{sheet.hidden ? " (hidden)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {headerRowSelect(
                "tracking",
                trackingSheet,
                mapping.tracking.headerRow,
              )}
              <div className="mapping-grid">
                {TRACKING_FIELDS.map(([field, label, required]) =>
                  columnSelect(
                    "tracking",
                    field,
                    label,
                    required,
                    trackingSheet,
                    (mapping.tracking.columns as any)[field],
                  ),
                )}
              </div>
            </div>

            <div className="mapping-role-card">
              <label className="mapping-sheet-select">
                <span>Names and master-data worksheet</span>
                <select
                  value={mapping.master?.sheetId ?? ""}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    chooseRoleSheet(
                      "master",
                      event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    )
                  }
                >
                  <option value="">No separate master worksheet</option>
                  {inspection.sheets.map((sheet) => (
                    <option key={sheet.sheetId} value={sheet.sheetId}>
                      {sheet.title}{sheet.hidden ? " (hidden)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {mapping.master && masterSheet ? (
                <>
                  {headerRowSelect(
                    "master",
                    masterSheet,
                    mapping.master.headerRow,
                  )}
                <div className="mapping-grid">
                  {MASTER_FIELDS.map(([field, label]) =>
                    columnSelect(
                      "master",
                      field,
                      label,
                      false,
                      masterSheet,
                      (mapping.master?.columns as any)?.[field],
                    ),
                  )}
                </div>
                </>
              ) : null}
            </div>

            <button
              type="button"
              className="btn btn-success btn-large mapping-save"
              onClick={() => void saveManualMapping()}
              disabled={busy}
            >
              {busy ? <Loader2 className="spin" size={19} /> : <CheckCircle2 size={19} />}
              Connect this Google Sheet
            </button>
          </section>
        ) : null}
      </div>
    </main>
  );
}
