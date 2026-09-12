import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Plus,
  RotateCw,
  Send,
  Settings2,
  X,
} from "lucide-react";
import { getFaviconUrl } from "@/lib/favicon";
import { ARC_IPC, AGENT_IPC, type ArcState, type Tab } from "@shared/ipc";

type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

const RAIL = 64;
const EXPANDED = 236;
const PAD = 6;

function Favicon({ url, size = 16 }: { url: string; size?: number }) {
  const src = getFaviconUrl(url);
  if (!src) return <span className="rounded" style={{ width: size, height: size, background: "rgba(255,255,255,0.15)" }} />;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-[4px]"
      style={{ width: size, height: size }}
      onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")}
    />
  );
}

function TabRow({
  tab,
  active,
  expanded,
  invoke,
}: {
  tab: Tab;
  active: boolean;
  expanded: boolean;
  invoke: Invoke;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative flex items-center"
      style={{ height: 34, margin: "2px 0" }}
    >
      <button
        type="button"
        onClick={() => void invoke(ARC_IPC.activateTab, tab.id)}
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left"
        style={{
          height: 34,
          borderRadius: 14,
          padding: expanded ? "0 28px 0 8px" : 0,
          justifyContent: expanded ? "flex-start" : "center",
          background: active ? "rgba(255,255,255,0.14)" : hover ? "rgba(255,255,255,0.08)" : "transparent",
          transition: "background 0.12s ease, scale 0.1s ease",
          scale: active ? "0.985" : "1",
        }}
        title={tab.title}
      >
        <Favicon url={tab.url} />
        {expanded ? (
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{tab.title || tab.url}</span>
        ) : null}
        {expanded && tab.loading ? <span className="text-[10px] text-muted-foreground">···</span> : null}
      </button>
      {expanded && hover ? (
        <button
          type="button"
          aria-label="Close tab"
          onClick={() => void invoke(ARC_IPC.closeTab, tab.id)}
          className="absolute right-1 flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-white/15 hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
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
  const [pinned, setPinned] = useState(true);
  const [hover, setHover] = useState(false);
  const expanded = pinned || hover;
  const [draft, setDraft] = useState(active?.url ?? "");
  const [editing, setEditing] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentText, setAgentText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(active?.url ?? "");
  }, [active?.url, editing]);

  const activeSpace = state.spaces.find((s) => s.id === state.activeSpaceId) ?? state.spaces[0];
  const tabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);
  const essentials = tabs.filter((t) => t.kind === "pinned" && !t.folderId);
  const normal = tabs.filter((t) => t.kind === "today");
  const width = expanded ? EXPANDED : RAIL;

  const navigate = () => {
    if (active) void invoke(ARC_IPC.navigate, { id: active.id, url: draft });
    else void invoke(ARC_IPC.newTab, { url: draft });
    inputRef.current?.blur();
  };

  return (
    <aside
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative z-20 flex h-full shrink-0 flex-col border-r border-border"
      style={{
        width,
        background: "var(--background)",
        transition: "width 0.2s ease",
        padding: PAD,
      }}
    >
      {/* Top toolbar: navigation + URL bar (single-toolbar), moved into the sidebar */}
      <div style={{ paddingBottom: PAD }} data-drag-region="">
        <div className="flex items-center gap-1" style={{ height: 28 }}>
          <button
            type="button"
            aria-label="Back"
            onClick={() => active && void invoke(ARC_IPC.back, active.id)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Forward"
            onClick={() => active && void invoke(ARC_IPC.forward, active.id)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <ArrowRight className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Reload"
            onClick={() => active && void invoke(ARC_IPC.reload, active.id)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <RotateCw className="size-3.5" />
          </button>
          {expanded ? (
            <>
              <button
                type="button"
                aria-label="Workspaces"
                className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-white/10 hover:text-foreground"
              >
                <span className="size-2 rounded-full" style={{ background: activeSpace?.color }} />
                <ChevronDown className="size-3" />
              </button>
              <button
                type="button"
                aria-label="Collapse sidebar"
                onClick={() => setPinned((v) => !v)}
                className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
              >
                <Settings2 className="size-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label="Expand sidebar"
              onClick={() => setPinned(true)}
              className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10 hover:text-foreground"
            >
              <Settings2 className="size-3.5" />
            </button>
          )}
        </div>

        <input
          ref={inputRef}
          data-address-input=""
          aria-label="Address"
          value={draft}
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
          placeholder="Search or enter address"
          className="mt-1.5 w-full truncate text-center text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:text-left"
          style={{
            height: 34,
            borderRadius: 14,
            background: "color-mix(in srgb, var(--primary) 4%, rgb(24,24,24) 96%)",
            padding: expanded ? "0 12px" : "0 4px",
            border: "1px solid transparent",
          }}
        />
      </div>

      {/* Essentials (pinned) — grid */}
      {essentials.length > 0 ? (
        <div className={expanded ? "grid grid-cols-4 gap-1.5 pb-2" : "flex flex-col items-center gap-2 pb-2"}>
          {essentials.map((tab) => (
            <button
              key={tab.id}
              type="button"
              title={tab.title}
              onClick={() => void invoke(ARC_IPC.activateTab, tab.id)}
              className="flex items-center justify-center rounded-[14px] hover:bg-white/10"
              style={{
                width: expanded ? 46 : 40,
                height: expanded ? 46 : 40,
                background: tab.id === state.activeTabId ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
              }}
            >
              <Favicon url={tab.url} size={22} />
            </button>
          ))}
        </div>
      ) : null}

      {/* Tabs */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {normal.map((tab) => (
          <TabRow key={tab.id} tab={tab} active={tab.id === state.activeTabId} expanded={expanded} invoke={invoke} />
        ))}
      </div>

      {/* Agent rail (collapsed dock) */}
      <div className="border-t border-border pt-2">
        <button
          type="button"
          onClick={() => setAgentOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-[14px] px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          <span className="size-2 rounded-full bg-primary" />
          {expanded ? <span className="flex-1 text-left">Agent</span> : null}
        </button>
        {agentOpen && expanded ? (
          <form
            className="mt-2 flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const text = agentText.trim();
              if (!text) return;
              void invoke(AGENT_IPC.prompt, { sessionId: null, text });
              setAgentText("");
            }}
          >
            <input
              value={agentText}
              onChange={(e) => setAgentText(e.target.value)}
              placeholder="Message the agent…"
              className="min-w-0 flex-1 text-[12px] outline-none placeholder:text-muted-foreground"
              style={{ height: 32, borderRadius: 14, background: "rgba(255,255,255,0.06)", padding: "0 10px" }}
            />
            <button type="submit" aria-label="Send" className="flex size-7 items-center justify-center rounded-md hover:bg-white/10">
              <Send className="size-3.5" />
            </button>
          </form>
        ) : null}
      </div>

      {/* Footer: new tab + workspaces */}
      <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
        <button
          type="button"
          aria-label="New tab"
          onClick={() => void invoke(ARC_IPC.newTab, {})}
          className="flex size-7 items-center justify-center rounded-[14px] text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
        {state.spaces.map((space) => (
          <button
            key={space.id}
            type="button"
            title={space.name}
            aria-label={space.name}
            onClick={() => void invoke(ARC_IPC.activateSpace, space.id)}
            className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold transition-transform hover:scale-110"
            style={{
              background: space.id === state.activeSpaceId ? space.color : "transparent",
              color: space.id === state.activeSpaceId ? "#0b0d0f" : space.color,
              boxShadow: space.id === state.activeSpaceId ? "none" : `inset 0 0 0 1px ${space.color}66`,
            }}
          >
            {space.name.slice(0, 1).toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          aria-label="Command bar"
          onClick={onCommand}
          className="ml-auto rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          ⌘T
        </button>
      </div>
    </aside>
  );
}
