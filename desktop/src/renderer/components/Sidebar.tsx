import { useState } from "react";
import { ARC_IPC, type ArcState, type Tab } from "@shared/ipc";
import { AgentRail } from "./AgentRail";
import { Row, Tile } from "./Tile";

type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

export function Sidebar({
  state,
  invoke,
  onCommand,
}: {
  state: ArcState;
  invoke: Invoke;
  onCommand: () => void;
}) {
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [folderCollapsed, setFolderCollapsed] = useState<Record<string, boolean>>({});

  const open = pinnedOpen || hover;
  const activeSpace = state.spaces.find((s) => s.id === state.activeSpaceId) ?? state.spaces[0];
  const tabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);
  const favorites = tabs.filter((t) => t.kind === "pinned" && !t.folderId);
  const today = tabs.filter((t) => t.kind === "today");
  const folders = state.folders.filter((f) => f.spaceId === state.activeSpaceId);

  const activate = (id: string) => void invoke(ARC_IPC.activateTab, id);
  const close = (id: string) => void invoke(ARC_IPC.closeTab, id);
  const pin = (id: string) => void invoke(ARC_IPC.pinTab, id);
  const unpin = (id: string) => void invoke(ARC_IPC.unpinTab, id);

  const tabRow = (tab: Tab) => (
    <Row
      key={tab.id}
      tab={tab}
      active={tab.id === state.activeTabId}
      collapsed={!open}
      onActivate={() => activate(tab.id)}
      onClose={() => close(tab.id)}
      onPin={() => pin(tab.id)}
      onUnpin={() => unpin(tab.id)}
    />
  );

  return (
    <aside
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-open={open ? "true" : "false"}
      className="relative z-20 flex h-full shrink-0 flex-col border-r border-white/10 bg-[color-mix(in_srgb,var(--gp-panel)_92%,black)] transition-[width] duration-200 ease-out"
      style={{ width: open ? 264 : 68 }}
    >
      <div className="flex h-12 items-center gap-1 px-3" data-drag-region="">
        {open ? (
          <>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" style={{ color: activeSpace?.color }}>
              {activeSpace?.name ?? "Home"}
            </span>
            <button
              type="button"
              aria-label="New tab"
              className="rounded-md px-2 py-1 text-[var(--gp-muted)] hover:bg-white/10 hover:text-[var(--gp-ink)]"
              onClick={() => void invoke(ARC_IPC.newTab, {})}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Command bar"
              className="rounded-md px-2 py-1 text-[var(--gp-muted)] hover:bg-white/10 hover:text-[var(--gp-ink)]"
              onClick={onCommand}
            >
              ⌘
            </button>
            <button
              type="button"
              aria-label="Collapse sidebar"
              className="rounded-md px-2 py-1 text-[var(--gp-muted)] hover:bg-white/10 hover:text-[var(--gp-ink)]"
              onClick={() => setPinnedOpen((v) => !v)}
            >
              ⇤
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-label="Expand sidebar"
              className="flex size-9 items-center justify-center rounded-lg text-[var(--gp-muted)] hover:bg-white/10"
              onClick={() => setPinnedOpen(true)}
            >
              ▸
            </button>
            <button
              type="button"
              aria-label="New tab"
              className="flex size-9 items-center justify-center rounded-lg text-[var(--gp-muted)] hover:bg-white/10"
              onClick={() => void invoke(ARC_IPC.newTab, {})}
            >
              +
            </button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {favorites.length > 0 ? (
          <div className={`mb-2 grid gap-1 ${open ? "grid-cols-4" : "grid-cols-1 justify-items-center"}`}>
            {favorites.map((tab) => (
              <button
                key={tab.id}
                type="button"
                title={tab.title}
                data-active={tab.id === state.activeTabId ? "true" : "false"}
                onClick={() => activate(tab.id)}
                className="flex size-11 items-center justify-center rounded-xl hover:bg-white/10 data-[active=true]:bg-white/15"
              >
                <Tile tab={tab} size={30} />
              </button>
            ))}
          </div>
        ) : null}

        {folders.map((folder) => {
          const folderTabs = tabs.filter((t) => t.folderId === folder.id);
          const collapsed = folderCollapsed[folder.id] ?? false;
          return (
            <div key={folder.id} className="mb-1">
              <button
                type="button"
                className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] uppercase tracking-wide text-[var(--gp-muted)] hover:text-[var(--gp-ink)]"
                onClick={() => setFolderCollapsed((prev) => ({ ...prev, [folder.id]: !collapsed }))}
              >
                <span style={{ transform: collapsed ? "rotate(-90deg)" : "none" }}>▾</span>
                {open ? folder.name : ""}
              </button>
              {collapsed ? null : folderTabs.map(tabRow)}
            </div>
          );
        })}

        {today.length > 0 ? (
          <div className="mt-2">
            {open ? (
              <p className="px-2 py-1 text-[10.5px] uppercase tracking-widest text-[var(--gp-muted)]">Today</p>
            ) : (
              <div className="my-1 h-px bg-white/10" />
            )}
            {today.map(tabRow)}
          </div>
        ) : null}
      </div>

      <AgentRail />

      <div className="border-t border-white/10 px-2 py-2">
        <div className="flex items-center gap-1">
          {state.spaces.map((space) => (
            <button
              key={space.id}
              type="button"
              title={space.name}
              aria-label={space.name}
              onClick={() => void invoke(ARC_IPC.activateSpace, space.id)}
              className="flex size-7 items-center justify-center rounded-full text-[11px] transition-transform hover:scale-110"
              style={{
                background: space.id === state.activeSpaceId ? space.color : "transparent",
                color: space.id === state.activeSpaceId ? "#0b0d0f" : space.color,
                border: space.id === state.activeSpaceId ? "none" : `1px solid ${space.color}55`,
              }}
            >
              {space.name.slice(0, 1).toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            aria-label="New space"
            className="flex size-7 items-center justify-center rounded-full border border-white/15 text-[var(--gp-muted)] hover:bg-white/10"
            onClick={() => void invoke(ARC_IPC.createSpace, { name: `Space ${state.spaces.length + 1}` })}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Archive"
            className="ml-auto rounded-md px-2 py-1 text-[var(--gp-muted)] hover:bg-white/10"
            onClick={() => setArchiveOpen((v) => !v)}
          >
            ⧉
          </button>
        </div>
        {archiveOpen ? (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-1">
            {state.archive.length === 0 ? (
              <p className="p-2 text-[11px] text-[var(--gp-muted)]">Archive is empty.</p>
            ) : (
              state.archive.map((entry) => (
                <div key={entry.id} className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--gp-muted)] hover:bg-white/10">
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  <button
                    type="button"
                    aria-label="Restore"
                    className="rounded px-1 hover:bg-white/15"
                    onClick={() => void invoke(ARC_IPC.restoreTab, entry.id)}
                  >
                    ↺
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
