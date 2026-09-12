import {
  type BrowserSurfaceProps,
  type BrowserUiState,
  browserLayout,
  CHROME_IPC,
  DEFAULT_PREFERENCES,
  glanceLayout,
  type Invoke,
  legacyPreferences,
} from "@shared/browser-ui";
import {
  ARC_IPC,
  ARC_STATE_EVENT,
  type ArcState,
  emptyState,
  getPaneTabIds,
} from "@shared/ipc";
import { ArrowUpRight, PanelLeftClose, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BrowserOverlay } from "./components/browser/BrowserOverlay";
import { Sidebar } from "./components/Sidebar";
import "./styles/zen-shell.css";

const initialUi: BrowserUiState = {
  dark: true,
  overlay: null,
  preferences: DEFAULT_PREFERENCES,
  sidebar: { dragging: false, focused: false, hovered: false },
};
const surface =
  new URLSearchParams(window.location.search).get("surface") ?? "main";
document.body.dataset.surface = surface;

function useWindowSize() {
  const [size, setSize] = useState({ height: innerHeight, width: innerWidth });
  useEffect(() => {
    const resize = () => setSize({ height: innerHeight, width: innerWidth });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return size;
}

function MainSurface({ state, ui, invoke }: BrowserSurfaceProps) {
  const size = useWindowSize();
  const { content } = browserLayout(size.width, size.height, ui);
  const paneIds = getPaneTabIds(state);
  const split = state.tabs.find((tab) => tab.id === state.splitTabId);
  const panes = paneIds.length
    ? paneIds.map((id) => state.tabs.find((tab) => tab.id === id))
    : [undefined];
  return (
    <main aria-label="Browser content" className="zen-window-shell">
      <div className="zen-window-drag" data-drag-region="" />
      {ui.preferences.bookmarksBar ? (
        <nav
          aria-label="Bookmarks"
          className="zen-bookmarks-bar"
          style={{
            left: content.x,
            right: size.width - content.x - content.width,
          }}
        >
          {state.tabs
            .filter((tab) => tab.kind === "pinned" && !tab.folderId)
            .slice(0, 10)
            .map((tab) => (
              <button
                key={tab.id}
                onClick={() => void invoke(ARC_IPC.activateTab, tab.id)}
              >
                {tab.customTitle || tab.title}
              </button>
            ))}
          {!state.tabs.some((tab) => tab.kind === "pinned") ? (
            <span>Your Essentials appear here</span>
          ) : null}
        </nav>
      ) : null}
      <div
        className="zen-browser-cards"
        data-split={Boolean(split)}
        style={{
          height: content.height,
          left: content.x,
          top: content.y,
          width: content.width,
        }}
      >
        {panes.map((tab) => (
          <section
            aria-label={tab?.title || "New Tab"}
            className="zen-content-card"
            data-active={tab?.id === state.activeTabId}
            key={tab?.id ?? "empty"}
            onMouseDown={() => {
              if (tab && tab.id !== state.activeTabId)
                void invoke(ARC_IPC.activateTab, tab.id);
            }}
          >
            {tab?.loading ? (
              <div
                aria-label="Loading page"
                className="zen-page-progress"
                role="progressbar"
              />
            ) : null}
            {tab?.error ? (
              <div className="zen-page-error" role="alert">
                <h1>Unable to open this page</h1>
                <p>{tab.url}</p>
                <p>{tab.error}</p>
                <button onClick={() => void invoke(ARC_IPC.reload, tab.id)}>
                  <RefreshCw size={15} /> Try again
                </button>
              </div>
            ) : null}
          </section>
        ))}
      </div>
      {split ? (
        <button
          aria-label="Exit split view"
          className="zen-unsplit"
          onClick={() => void invoke(ARC_IPC.toggleSplit, split.id)}
          style={{
            left: content.x + Math.floor(content.width / 2) - 12,
            top: content.y + content.height - 34,
          }}
          title="Exit split view"
        >
          <PanelLeftClose size={16} />
        </button>
      ) : null}
    </main>
  );
}

function GlanceSurface({ state, ui, invoke }: BrowserSurfaceProps) {
  const size = useWindowSize();
  const { frame } = glanceLayout(size.width, size.height);
  return (
    <div
      className="zen-glance-backdrop"
      onMouseDown={() => void invoke(ARC_IPC.closePeek)}
    >
      <section
        aria-label="Glance"
        aria-modal="true"
        className="zen-glance-frame"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        style={{
          height: frame.height,
          left: frame.x,
          top: frame.y,
          width: frame.width,
        }}
      >
        <header
          aria-label={state.glance?.title || "Glance"}
          className="zen-glance-actions"
          data-side={ui.preferences.side}
        >
          <button
            aria-label="Close Glance"
            onClick={() => void invoke(ARC_IPC.closePeek)}
            title="Close Glance (Escape)"
          >
            <X size={16} />
          </button>
          <button
            aria-label="Open Glance in tab"
            onClick={() => void invoke(ARC_IPC.promotePeek)}
            title="Open in tab"
          >
            <ArrowUpRight size={16} />
          </button>
        </header>
      </section>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<ArcState>(emptyState);
  const [ui, setUi] = useState<BrowserUiState>(initialUi);
  const [error, setError] = useState<string | null>(null);
  const invoke: Invoke = useCallback(
    (channel, payload) => window.zenmium.invoke(channel, payload),
    []
  );
  useEffect(() => {
    const offState = window.zenmium.on(ARC_STATE_EVENT, (value) =>
      setState(value as ArcState)
    );
    const offUi = window.zenmium.on(CHROME_IPC.event, (value) =>
      setUi(value as BrowserUiState)
    );
    let legacy = {};
    if (surface === "main") {
      try {
        legacy = legacyPreferences(
          Object.fromEntries(
            ["compact", "expanded", "side", "width", "newTabTop"].map((key) => [
              key,
              localStorage.getItem(`zen.sidebar.${key}`),
            ])
          )
        );
      } catch {
        /* Storage may be unavailable; use backward-compatible defaults. */
      }
    }
    const migration =
      surface === "main"
        ? invoke(CHROME_IPC.migratePreferences, legacy)
        : Promise.resolve();
    void migration
      .then(() =>
        Promise.all([
          invoke<ArcState>(ARC_IPC.snapshot),
          invoke<BrowserUiState>(CHROME_IPC.snapshot),
        ])
      )
      .then(([arc, chrome]) => {
        setState(arc);
        setUi(chrome);
      })
      .catch((reason) => setError(String(reason)));
    return () => {
      offState();
      offUi();
    };
  }, [invoke]);
  useEffect(() => {
    document.documentElement.dataset.theme = ui.dark ? "dark" : "light";
    document.documentElement.style.colorScheme = ui.dark ? "dark" : "light";
    const space = state.spaces.find((s) => s.id === state.activeSpaceId);
    if (space)
      document.documentElement.style.setProperty(
        "--zen-workspace-color",
        space.color
      );
  }, [state.activeSpaceId, state.spaces, ui.dark]);
  if (error)
    return (
      <div className="zen-page-error" role="alert">
        <h1>Browser unavailable</h1>
        <p>{error}</p>
      </div>
    );
  const props = { invoke, state, ui };
  if (surface === "sidebar") return <Sidebar {...props} />;
  if (surface === "overlay")
    return ui.overlay ? (
      <BrowserOverlay {...props} />
    ) : state.glance ? (
      <GlanceSurface {...props} />
    ) : null;
  return <MainSurface {...props} />;
}
