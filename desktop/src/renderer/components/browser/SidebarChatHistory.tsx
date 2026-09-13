import { CHROME_IPC, type ChatHistoryEntry, type Invoke } from "@shared/browser-ui";
import { CHAT_IPC, type ChatChange, type ChatHistorySummary, type ChatResult } from "@shared/agent-chat";
import { ARC_IPC, type Space } from "@shared/ipc";
import { ChevronDown, MessageCircle, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import "../../styles/zen-chat.css";

function ageLabel(updatedAt: number) {
  const age = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(updatedAt);
}

export function SidebarChatHistory({
  activeSpaceId,
  entries,
  invoke,
  overlayChatId,
  spaces,
}: {
  activeSpaceId: string;
  entries: ChatHistoryEntry[];
  invoke: Invoke;
  overlayChatId?: string;
  spaces: Space[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [allWorkspaces, setAllWorkspaces] = useState(true);
  const [history, setHistory] = useState<ChatHistorySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    let disposed = false;
    void invoke<ChatResult<ChatHistorySummary[]>>(CHAT_IPC.list).then((result) => {
      if (!disposed && result?.ok) setHistory(result.value);
    }).catch(() => { /* Legacy summaries remain readable if the optional chat service is unavailable. */ });
    const unsubscribe = window.zenmium?.on(CHAT_IPC.event, (payload) => {
      const change = payload as ChatChange;
      if (change?.version !== 1 || !change.conversation) return;
      const { id, title, spaceId, updatedAt, status } = change.conversation;
      setHistory((current) => [{ id, title, spaceId, updatedAt, status }, ...(current ?? []).filter((entry) => entry.id !== id)]);
    });
    return () => { disposed = true; unsubscribe?.(); };
  }, [invoke]);
  useEffect(() => {
    if (!expanded) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [expanded]);
  const currentSpace = spaces.find((space) => space.id === activeSpaceId);
  const visibleEntries = useMemo(
    () =>
      (history ?? entries)
        .filter((entry) => allWorkspaces || entry.spaceId === activeSpaceId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [activeSpaceId, allWorkspaces, entries, history],
  );
  const groups = useMemo(() => {
    const knownSpaces = new Map(spaces.map((space) => [space.id, space]));
    const grouped = new Map<string, ChatHistoryEntry[]>();
    for (const entry of visibleEntries) {
      const list = grouped.get(entry.spaceId) ?? [];
      list.push(entry);
      grouped.set(entry.spaceId, list);
    }
    return [...grouped.entries()]
      .map(([spaceId, group]) => ({
        entries: group,
        spaceId,
        space: knownSpaces.get(spaceId),
      }))
      .sort((a, b) => {
        if (!a.space || !b.space) return a.space ? -1 : b.space ? 1 : 0;
        return a.space.name.localeCompare(b.space.name);
      });
  }, [spaces, visibleEntries]);

  return (
    <section
      aria-label="Chat history"
      className="zen-chat-history t-acc"
      data-open={expanded}
    >
      <button
        aria-expanded={expanded}
        className="zen-chat-history-toggle"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <MessageCircle aria-hidden="true" size={14} />
        <span>Chat history</span>
        <ChevronDown aria-hidden="true" className="t-acc-chevron" size={13} />
      </button>
      <div className="zen-chat-history-popover t-acc-panel">
        <div className="t-acc-panel-inner">
          <div className="zen-chat-history-tools">
            <button
              aria-pressed={allWorkspaces}
              className="zen-chat-history-filter"
              onClick={() => setAllWorkspaces((value) => !value)}
              title="Toggle between all workspaces and the current workspace"
              type="button"
            >
              <span>{allWorkspaces ? "All workspaces" : currentSpace?.name}</span>
              <ChevronDown aria-hidden="true" size={12} />
            </button>
            <button
              aria-label="New conversation"
              onClick={async () => {
                setError(null);
                try {
                  const result = await invoke<ChatResult<{ id: string }>>(CHAT_IPC.create, { spaceId: activeSpaceId });
                  if (!result?.ok) {
                    setError(result?.ok === false ? result.reason : "Chat is unavailable.");
                    return;
                  }
                  void invoke(CHROME_IPC.open, { kind: "agent", chatId: result.value.id, spaceId: activeSpaceId });
                } catch {
                  setError("The conversation could not be created.");
                }
              }}
              title="New conversation"
              type="button"
            >
              <Plus size={13} />
            </button>
          </div>
          {error ? <p className="zen-chat-history-error" role="status">{error}</p> : null}
          {groups.length ? (
            groups.map(({ entries: group, space, spaceId }) => (
              <div className="zen-chat-history-group" key={spaceId}>
                <div
                  className="zen-chat-history-workspace"
                  style={{ "--zen-chat-space-color": space?.color } as CSSProperties}
                >
                  <span>{space?.name ?? "Workspace"}</span>
                </div>
                {group.map((entry) => (
                  <button
                    aria-current={overlayChatId === entry.id ? "page" : undefined}
                    className="zen-chat-history-row"
                    key={entry.id}
                    onClick={async () => {
                      setError(null);
                      if (!space) { setError("This conversation's Workspace no longer exists."); return; }
                      try {
                        if (entry.spaceId !== activeSpaceId) {
                          await invoke(ARC_IPC.activateSpace, entry.spaceId);
                        }
                        await invoke(CHROME_IPC.open, {
                          chatId: entry.id,
                          kind: "agent",
                          spaceId: entry.spaceId,
                        });
                      } catch { setError("The conversation could not be opened."); }
                    }}
                    title={entry.title}
                    type="button"
                  >
                    <span>{entry.title}</span>
                    <time dateTime={new Date(entry.updatedAt).toISOString()}>
                      {ageLabel(entry.updatedAt)}
                    </time>
                  </button>
                ))}
              </div>
            ))
          ) : (
            <p className="zen-chat-history-empty">No conversations yet</p>
          )}
        </div>
      </div>
    </section>
  );
}
