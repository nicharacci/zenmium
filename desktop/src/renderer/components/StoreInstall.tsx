/**
 * StoreInstall — install progress UI for the wrapped extension install.
 *
 * Presentation only. It never touches Electron, the network, or the store. The base renderer
 * supplies `install` (an IPC invoker) and `subscribe` (a progress subscription); this component
 * renders the state machine and reports results back through props callbacks.
 *
 * States: idle, resolving, downloading (with percent), verifying, extracting, installing, done,
 * error. No store branding or attribution is shown, and none should be added.
 *
 * Types are imported type-only from the main-process module, so no runtime main code is pulled
 * into the renderer bundle.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import type {
  StoreInstallProgress,
  StoreInstallResult,
  StoreInstallStage,
} from "../../main/store-install";

export interface StoreInstallProps {
  /** Subscribes to store-install progress. Returns an unsubscribe function. */
  subscribe: (listener: (progress: StoreInstallProgress) => void) => () => void;
  /** Kicks off an install for an id or detail URL and resolves with the terminal result. */
  install: (idOrUrl: string) => Promise<StoreInstallResult>;
  /** Called on every progress event. */
  onProgress?: (progress: StoreInstallProgress) => void;
  /** Called once with the terminal result. */
  onResult?: (result: StoreInstallResult) => void;
  /** Initial value for the input. */
  defaultValue?: string;
  /** Optional class name for layout integration. */
  className?: string;
  /** Heading text. Kept generic on purpose. */
  heading?: string;
  /** Button text. Kept generic on purpose. */
  buttonLabel?: string;
}

interface ViewState {
  stage: StoreInstallStage;
  name: string | null;
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  reason: string | null;
}

const INITIAL_STATE: ViewState = {
  stage: "idle",
  name: null,
  receivedBytes: 0,
  totalBytes: null,
  percent: null,
  reason: null,
};

const STAGE_LABEL: Record<StoreInstallStage, string> = {
  idle: "Ready to install",
  resolving: "Resolving package",
  downloading: "Downloading",
  verifying: "Verifying package",
  extracting: "Extracting files",
  installing: "Installing",
  done: "Installed",
  error: "Install failed",
};

/**
 * Deterministic bar width per stage. Downloading uses real percent when the server sends a
 * content length; otherwise the bar stays indeterminate at a low fill.
 */
function stageFill(stage: StoreInstallStage, percent: number | null): number {
  switch (stage) {
    case "idle":
      return 0;
    case "resolving":
      return 8;
    case "downloading":
      return percent === null ? 20 : Math.min(70, 8 + percent * 0.62);
    case "verifying":
      return 76;
    case "extracting":
      return 88;
    case "installing":
      return 96;
    case "done":
      return 100;
    case "error":
      return 100;
    default:
      return 0;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit] ?? "B"}`;
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: "var(--zenmium-text, #1a1a1a)",
    maxWidth: 420,
  } as const,
  heading: { fontSize: 14, fontWeight: 600, margin: 0 } as const,
  row: { display: "flex", gap: 8, alignItems: "center" } as const,
  input: {
    flex: 1,
    minWidth: 0,
    height: 32,
    borderRadius: 8,
    border: "1px solid rgba(0,0,0,0.18)",
    padding: "0 10px",
    fontSize: 13,
    background: "var(--zenmium-surface, #fff)",
    color: "inherit",
  } as const,
  button: {
    height: 32,
    borderRadius: 8,
    border: "1px solid rgba(0,0,0,0.18)",
    padding: "0 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    background: "var(--zenmium-accent, #2f6fed)",
    color: "#fff",
  } as const,
  buttonDisabled: { opacity: 0.5, cursor: "default" } as const,
  track: {
    height: 6,
    borderRadius: 999,
    background: "rgba(0,0,0,0.10)",
    overflow: "hidden",
  } as const,
  fill: {
    height: "100%",
    borderRadius: 999,
    background: "var(--zenmium-accent, #2f6fed)",
    transition: "width 160ms ease",
  } as const,
  meta: { fontSize: 12, opacity: 0.75, minHeight: 16 } as const,
  error: { fontSize: 12, color: "#b42318", minHeight: 16 } as const,
} as const;

export function StoreInstall(props: StoreInstallProps): ReactElement {
  const {
    subscribe,
    install,
    onProgress,
    onResult,
    defaultValue = "",
    className,
    heading = "Install extension",
    buttonLabel = "Install",
  } = props;

  const [value, setValue] = useState(defaultValue);
  const [state, setState] = useState<ViewState>(INITIAL_STATE);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  const busy = useMemo(
    () =>
      state.stage === "resolving" ||
      state.stage === "downloading" ||
      state.stage === "verifying" ||
      state.stage === "extracting" ||
      state.stage === "installing",
    [state.stage],
  );

  useEffect(() => {
    const unsubscribe = subscribe((progress) => {
      setState({
        stage: progress.stage,
        name: progress.name,
        receivedBytes: progress.receivedBytes,
        totalBytes: progress.totalBytes,
        percent: progress.percent,
        reason: progress.reason,
      });
      onProgressRef.current?.(progress);
    });
    return unsubscribe;
  }, [subscribe]);

  const handleInstall = async (): Promise<void> => {
    const target = value.trim();
    if (target.length === 0 || busy) {
      return;
    }
    setState({ ...INITIAL_STATE, stage: "resolving" });
    try {
      const result = await install(target);
      if (result.ok) {
        setState((previous) => ({
          ...previous,
          stage: "done",
          name: result.name,
          percent: 100,
          reason: null,
        }));
      } else {
        setState((previous) => ({
          ...previous,
          stage: "error",
          reason: result.reason,
        }));
      }
      onResult?.(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setState((previous) => ({ ...previous, stage: "error", reason }));
    }
  };

  const fill = stageFill(state.stage, state.percent);
  const showPercent =
    state.stage === "downloading" && state.percent !== null
      ? `${state.percent}%`
      : state.stage === "done"
        ? "100%"
        : state.totalBytes !== null && state.receivedBytes > 0
          ? formatBytes(state.receivedBytes)
          : "";

  return (
    <div className={className} style={styles.root}>
      <p style={styles.heading}>{heading}</p>

      <div style={styles.row}>
        <label htmlFor="zenmium-store-install-input" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          Extension id or URL
        </label>
        <input
          id="zenmium-store-install-input"
          style={styles.input}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder="Extension id or detail URL"
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleInstall();
            }
          }}
        />
        <button
          type="button"
          style={busy ? { ...styles.button, ...styles.buttonDisabled } : styles.button}
          disabled={busy || value.trim().length === 0}
          onClick={() => {
            void handleInstall();
          }}
        >
          {busy ? "Installing…" : buttonLabel}
        </button>
      </div>

      {state.stage !== "idle" ? (
        <div>
          <div
            role="progressbar"
            aria-label={STAGE_LABEL[state.stage]}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(state.percent !== null && state.stage === "downloading"
              ? { "aria-valuenow": state.percent }
              : {})}
            style={styles.track}
          >
            <div style={{ ...styles.fill, width: `${fill}%` }} />
          </div>
          <div style={styles.meta} aria-live="polite">
            <span>{STAGE_LABEL[state.stage]}</span>
            {state.name !== null ? <span>{` · ${state.name}`}</span> : null}
            {showPercent.length > 0 ? <span>{` · ${showPercent}`}</span> : null}
          </div>
        </div>
      ) : null}

      {state.stage === "error" && state.reason !== null ? (
        <div style={styles.error} role="alert">
          {state.reason}
        </div>
      ) : null}
    </div>
  );
}

export default StoreInstall;
