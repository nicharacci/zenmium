import {
  type BrowserSurfaceProps,
  type BrowserUiState,
  browserLayout,
  AGENT_DOCK_WIDTH,
  CHROME_IPC,
  DEFAULT_PREFERENCES,
  glanceLayout,
  hasOverflowEssentials,
  type Invoke,
  legacyPreferences,
} from "@shared/browser-ui";
import {
  ARC_IPC,
  ARC_STATE_EVENT,
  MAX_ESSENTIALS,
  type ArcState,
  emptyState,
  getPaneTabIds,
} from "@shared/ipc";
import { CONTROL_IPC } from "@shared/browser-control";
import { ArrowUpRight, PanelLeftClose, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BrowserOverlay } from "./components/browser/BrowserOverlay";
import { BeuiChatDrawer } from "./components/browser/BeuiChatDrawer";
import { Sidebar } from "./components/Sidebar";
import { updateControlActivity } from "./components/browser/ShellModel";
import { OverflowEssentials } from "./components/browser/OverflowEssentials";
import { BookmarksPanel } from "./components/browser/BrowserNativePanels";
import "./styles/zen-shell.css";
import "./styles/zen-overlays.css";

const initialUi: BrowserUiState = {
  chatHistory: [],
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

function MainSurface({
  agentActivity,
  startupWave,
  state,
  ui,
  invoke,
}: BrowserSurfaceProps & {
  agentActivity: boolean;
  startupWave: boolean;
}) {
  const size = useWindowSize();
  const showBookmarks = ui.preferences.bookmarksBar && hasOverflowEssentials(state);
  const layoutUi = showBookmarks
    ? ui
    : {
        ...ui,
        preferences: { ...ui.preferences, bookmarksBar: false },
      };
  const { content } = browserLayout(size.width, size.height, layoutUi);
  const agentOpen = ui.overlay?.kind === "agent";
  const bookmarksOpen = ui.overlay?.kind === "bookmarks";
  const paneIds = getPaneTabIds(state);
  const split = state.tabs.find((tab) => tab.id === state.splitTabId);
  const panes = paneIds.length
    ? paneIds.map((id) => state.tabs.find((tab) => tab.id === id))
    : [undefined];
  return (
    <main aria-label="Browser content" className="zen-window-shell">
      <div className="zen-window-drag" data-drag-region="" />
      {startupWave ? (
        <div
          aria-hidden="true"
          className="zen-dither-wave zen-dither-wave--startup"
        />
      ) : null}
      {agentActivity ? (
        <div
          aria-hidden="true"
          className="zen-dither-wave zen-dither-wave--agent"
        />
      ) : null}
      {showBookmarks ? (
        <OverflowEssentials
          tabs={state.tabs.filter((tab) =>
            tab.spaceId === state.activeSpaceId && tab.kind === "pinned" && !tab.folderId
          ).slice(MAX_ESSENTIALS)}
          activeTabId={state.activeTabId}
          invoke={invoke}
          style={{
            left: content.x,
            right: size.width - content.x - content.width,
          }}
        />
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
      {agentOpen ? (
        <aside
          aria-label="Agent"
          className={`zen-agent-docked${ui.preferences.themedChatWindow ? " is-chat-themed" : ""}`}
          style={{
            height: content.height,
            left: content.x + content.width + 8,
            top: content.y,
            width: AGENT_DOCK_WIDTH,
          }}
        >
          <BeuiChatDrawer
            invoke={invoke}
            state={state}
            ui={ui}
          />
        </aside>
      ) : null}
      {bookmarksOpen ? (
        <aside aria-label="Bookmarks" className="zen-utility-docked" style={{height: content.height, left: content.x + content.width + 8, top: content.y, width: AGENT_DOCK_WIDTH}}>
          <BookmarksPanel state={state} ui={ui} invoke={invoke} close={() => void invoke(CHROME_IPC.close, {sessionId: ui.overlay?.sessionId})}/>
        </aside>
      ) : null}
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

function SidebarGutter({ invoke }: Pick<BrowserSurfaceProps, "invoke">) {
  return (
    <div
      aria-hidden="true"
      className="zen-sidebar-gutter"
      onMouseEnter={() => void invoke(CHROME_IPC.sidebar, { hovered: true })}
      onMouseLeave={() =>
        void invoke(CHROME_IPC.sidebar, { hovered: false, focused: false })
      }
    />
  );
}

export default function App() {
  const [state, setState] = useState<ArcState>(emptyState);
  const [ui, setUi] = useState<BrowserUiState>(initialUi);
  const [agentActivity, setAgentActivity] = useState(false);
  const [startupWave, setStartupWave] = useState(surface === "main");
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
    if (surface !== "main") return;
    const startupTimer = window.setTimeout(() => setStartupWave(false), 2800);
    let activity = { epoch: "", cursor: -1, requests: new Map<string, string>() };
    const offAgent = window.zenmium.on(CONTROL_IPC.event, (value) => {
      activity = updateControlActivity(activity, value);
      setAgentActivity(activity.requests.size > 0);
    });
    return () => {
      window.clearTimeout(startupTimer);
      offAgent();
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = ui.dark ? "dark" : "light";
    document.documentElement.style.colorScheme = ui.dark ? "dark" : "light";
    const space = state.spaces.find((s) => s.id === state.activeSpaceId);
    document.documentElement.style.setProperty(
      "--zen-glass-tint-amount",
      `${ui.preferences.glassTint}%`
    );
    if (space)
      document.documentElement.style.setProperty(
        "--zen-workspace-color",
        space.color
      );
  }, [state.activeSpaceId, state.spaces, ui.dark, ui.preferences.glassTint]);
  if (error)
    return (
      <div className="zen-page-error" role="alert">
        <h1>Browser unavailable</h1>
        <p>{error}</p>
      </div>
    );
  const props = { invoke, state, ui };
  if (surface === "sidebar") return <Sidebar {...props} />;
  if (surface === "gutter") return <SidebarGutter invoke={invoke} />;
  if (surface === "overlay")
    return ui.overlay ? (
      <BrowserOverlay {...props} />
    ) : state.glance ? (
      <GlanceSurface {...props} />
    ) : null;
  return (
    <MainSurface
      {...props}
      agentActivity={agentActivity}
      startupWave={startupWave}
    />
  );
}
