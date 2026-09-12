import { useEffect, useMemo, useState } from "react";
import { ARC_IPC, type ArcState } from "@shared/ipc";

type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

interface Item {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandBar({
  state,
  invoke,
  onClose,
}: {
  state: ArcState;
  invoke: Invoke;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? null;
  const spaceTabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const lower = q.toLowerCase();
    const list: Item[] = [];

    if (q.length > 0 && (/^[a-z0-9-]+\.[a-z]{2,}/i.test(q) || q.includes("://") || q.startsWith("localhost"))) {
      list.push({ id: "open", label: `Open ${q}`, hint: "Enter", run: () => void invoke(ARC_IPC.newTab, { url: q }) });
    }
    if (q.length > 0) {
      list.push({
        id: "search",
        label: `Search the web for "${q}"`,
        run: () => void invoke(ARC_IPC.newTab, { url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}` }),
      });
    }
    list.push({ id: "new-tab", label: "New Tab", hint: "⌘T", run: () => void invoke(ARC_IPC.newTab, {}) });
    list.push({
      id: "new-space",
      label: "New Space",
      run: () => void invoke(ARC_IPC.createSpace, { name: `Space ${state.spaces.length + 1}` }),
    });
    if (activeTab) {
      list.push({
        id: "pin",
        label: activeTab.kind === "pinned" ? "Unpin Tab" : "Pin Tab",
        hint: "⌘D",
        run: () => void invoke(activeTab.kind === "pinned" ? ARC_IPC.unpinTab : ARC_IPC.pinTab, activeTab.id),
      });
      list.push({ id: "archive", label: "Archive Tab", run: () => void invoke(ARC_IPC.archiveTab, activeTab.id) });
      list.push({ id: "split", label: "Toggle Split View", run: () => void invoke(ARC_IPC.toggleSplit, activeTab.id) });
    }
    list.push({
      id: "clear-today",
      label: "Archive All Today Tabs",
      hint: "⌘⇧K",
      run: () => {
        for (const tab of state.tabs.filter((t) => t.kind === "today")) void invoke(ARC_IPC.archiveTab, tab.id);
      },
    });
    for (const tab of spaceTabs) {
      if (lower && !tab.title.toLowerCase().includes(lower) && !tab.url.toLowerCase().includes(lower)) continue;
      list.push({
        id: `tab-${tab.id}`,
        label: tab.title || tab.url,
        hint: tab.kind === "pinned" ? "Pinned" : "Today",
        run: () => void invoke(ARC_IPC.activateTab, tab.id),
      });
    }
    return q.length === 0 ? list.slice(0, 8) : list.slice(0, 10);
  }, [query, state, invoke, activeTab, spaceTabs]);

  useEffect(() => setIndex(0), [query]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-[min(640px,80vw)] overflow-hidden rounded-2xl border border-white/12 bg-[#16191c] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          placeholder="Search tabs, enter a URL, or run a command…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            else if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((i) => Math.min(i + 1, items.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(items[index]);
            }
          }}
          className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-[14px] outline-none"
        />
        <ul className="max-h-[52vh] overflow-y-auto py-1">
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(item)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] ${
                  i === index ? "bg-white/10 text-[var(--gp-ink)]" : "text-[var(--gp-muted)]"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint ? <span className="text-[10px] uppercase tracking-wide opacity-60">{item.hint}</span> : null}
              </button>
            </li>
          ))}
          {items.length === 0 ? <li className="px-4 py-3 text-[12px] text-[var(--gp-muted)]">No matches.</li> : null}
        </ul>
      </div>
    </div>
  );
}
