import type { BrowserTab } from "@shared/ipc";
import { AgentRail } from "./AgentRail";

export function Sidebar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNewTab,
}: {
  tabs: BrowserTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
}) {
  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-white/10 bg-[var(--gp-panel)]">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[12px] font-semibold tracking-wide">Zenmium</span>
        <button
          type="button"
          aria-label="New tab"
          onClick={onNewTab}
          className="rounded px-2 py-0.5 text-[var(--gp-muted)] hover:bg-white/10 hover:text-[var(--gp-ink)]"
        >
          +
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {tabs.map((tab) => {
          const on = tab.id === activeId;
          return (
            <div
              key={tab.id}
              data-active={on ? "true" : "false"}
              className={`group flex items-center gap-1 rounded-md px-2 py-1 text-[12px] ${
                on ? "bg-white/10 text-[var(--gp-ink)]" : "text-[var(--gp-muted)]"
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate border-0 bg-transparent text-left"
                onClick={() => onSelect(tab.id)}
              >
                {tab.loading ? "… " : ""}
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
      </nav>
      <AgentRail />
    </aside>
  );
}
