import type { BrowserTab } from "@shared/ipc";

export function TabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: BrowserTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-end gap-1 border-b border-white/10 px-2">
      {tabs.map((tab) => {
        const on = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={`group flex max-w-[12rem] min-w-[7rem] items-center gap-1 rounded-t-md px-2 py-1 text-[11px] ${
              on ? "bg-white/10 text-[var(--gp-ink)]" : "text-[var(--gp-muted)]"
            }`}
          >
            <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onSelect(tab.id)}>
              {tab.title}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => onClose(tab.id)}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New tab"
        onClick={onNew}
        className="mb-1 rounded px-2 py-1 text-[var(--gp-muted)] hover:bg-white/10 hover:text-[var(--gp-ink)]"
      >
        +
      </button>
    </div>
  );
}
