import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, PanelLeft, Plus, RotateCw, Send } from "lucide-react";
import { getFaviconUrl } from "@/lib/favicon";
import { ARC_IPC, AGENT_IPC, type ArcState, type Tab } from "@shared/ipc";

type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

const EXPANDED = 230;
const COLLAPSED = 60;

function Favicon({ url, size = 16 }: { url: string; size?: number }) {
  const src = getFaviconUrl(url);
  if (!src) {
    return <span className="zen-tab-icon" style={{ background: "rgba(255,255,255,0.15)", width: size, height: size }} />;
  }
  return (
    <img
      src={src}
      alt=""
      className="zen-tab-icon"
      style={{ width: size, height: size }}
      onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")}
    />
  );
}

export function Sidebar({
  state,
  invoke,
  active,
  onCommand,
}: {
  state: ArcState;
  invoke: Invoke;
  active: Tab | null;
  onCommand: () => void;
}) {
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState(active?.url ?? "");
  const [editing, setEditing] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentText, setAgentText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const open = pinnedOpen || hover;

  useEffect(() => {
    if (!editing) setDraft(active?.url ?? "");
  }, [active?.url, editing]);

  const space = state.spaces.find((s) => s.id === state.activeSpaceId) ?? state.spaces[0];
  const tabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);
  const essentials = tabs.filter((t) => t.kind === "pinned" && !t.folderId);
  const normal = tabs.filter((t) => t.kind === "today");

  const navigate = () => {
    if (active) void invoke(ARC_IPC.navigate, { id: active.id, url: draft });
    else void invoke(ARC_IPC.newTab, { url: draft });
    inputRef.current?.blur();
  };

  return (
    <aside
      className="zen-sidebar"
      data-open={open ? "true" : "false"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ width: open ? EXPANDED : COLLAPSED }}
    >
      <div className="zen-top" data-drag-region="">
        <button type="button" aria-label="Back" className="zen-top-btn" onClick={() => active && void invoke(ARC_IPC.back, active.id)}>
          <ArrowLeft className="size-4" />
        </button>
        <button type="button" aria-label="Forward" className="zen-top-btn" onClick={() => active && void invoke(ARC_IPC.forward, active.id)}>
          <ArrowRight className="size-4" />
        </button>
        <button type="button" aria-label="Reload" className="zen-top-btn" onClick={() => active && void invoke(ARC_IPC.reload, active.id)}>
          <RotateCw className="size-3.5" />
        </button>
        {open ? (
          <button type="button" aria-label="Collapse sidebar" className="zen-top-btn ml-auto" onClick={() => setPinnedOpen(false)}>
            <PanelLeft className="size-4" />
          </button>
        ) : (
          <button type="button" aria-label="Expand sidebar" className="zen-top-btn ml-auto" onClick={() => setPinnedOpen(true)}>
            <PanelLeft className="size-4" />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        data-address-input=""
        aria-label="Address"
        className="zen-urlbar"
        value={draft}
        placeholder="Search or enter address"
        onFocus={() => {
          setEditing(true);
          setDraft(active?.url ?? "");
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") navigate();
          if (e.key === "Escape") {
            setDraft(active?.url ?? "");
            inputRef.current?.blur();
          }
        }}
      />

      {essentials.length > 0 ? (
        <div className="zen-essentials mt-1.5">
          {essentials.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="zen-essential"
              data-active={tab.id === state.activeTabId ? "true" : "false"}
              title={tab.title}
              onClick={() => void invoke(ARC_IPC.activateTab, tab.id)}
            >
              <Favicon url={tab.url} size={22} />
            </button>
          ))}
        </div>
      ) : null}

      <div className="zen-tabs mt-1">
        {normal.map((tab) => (
          <div key={tab.id} className="zen-tab" data-active={tab.id === state.activeTabId ? "true" : "false"}>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => void invoke(ARC_IPC.activateTab, tab.id)}
              title={tab.title}
            >
              <Favicon url={tab.url} />
              <span className="zen-tab-label">{tab.title || tab.url}</span>
            </button>
            <button
              type="button"
              aria-label="Close tab"
              className="zen-tab-close"
              onClick={() => void invoke(ARC_IPC.closeTab, tab.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="zen-agent">
        <button type="button" className="zen-agent-btn" onClick={() => setAgentOpen((v) => !v)}>
          <span className="size-2 rounded-full bg-primary" />
          {open ? <span className="flex-1 text-left">Agent</span> : null}
        </button>
        {agentOpen && open ? (
          <form
            className="zen-agent-form"
            onSubmit={(e) => {
              e.preventDefault();
              const text = agentText.trim();
              if (!text) return;
              void invoke(AGENT_IPC.prompt, { sessionId: null, text });
              setAgentText("");
            }}
          >
            <input
              className="zen-agent-input"
              value={agentText}
              onChange={(e) => setAgentText(e.target.value)}
              placeholder="Message the agent…"
            />
            <button type="submit" aria-label="Send" className="zen-top-btn">
              <Send className="size-3.5" />
            </button>
          </form>
        ) : null}
      </div>

      <div className="zen-foot">
        <button type="button" aria-label="New tab" className="zen-top-btn" onClick={() => void invoke(ARC_IPC.newTab, {})}>
          <Plus className="size-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-[3px] overflow-x-auto">
          {state.spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              className="zen-ws"
              data-active={s.id === state.activeSpaceId ? "true" : "false"}
              title={s.name}
              aria-label={s.name}
              onClick={() => void invoke(ARC_IPC.activateSpace, s.id)}
            >
              {s.name.slice(0, 1).toUpperCase()}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Command bar" className="zen-top-btn" onClick={onCommand}>
          <span className="text-[11px]">⌘T</span>
        </button>
      </div>
    </aside>
  );
}
