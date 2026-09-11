import { useEffect, useState } from "react";
import type { BrowserTab } from "@shared/ipc";

export function AddressBar({
  tab,
  onNavigate,
  onBack,
  onForward,
  onReload,
}: {
  tab: BrowserTab | null;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState(tab?.url ?? "");

  useEffect(() => {
    setDraft(tab?.url ?? "");
  }, [tab?.url]);

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-white/10 px-2 py-1.5" data-address-bar="">
      <button type="button" aria-label="Back" onClick={onBack} className="rounded px-2 py-0.5 text-[var(--gp-muted)] hover:bg-white/10">
        ‹
      </button>
      <button type="button" aria-label="Forward" onClick={onForward} className="rounded px-2 py-0.5 text-[var(--gp-muted)] hover:bg-white/10">
        ›
      </button>
      <button type="button" aria-label="Reload" onClick={onReload} className="rounded px-2 py-0.5 text-[var(--gp-muted)] hover:bg-white/10">
        ⟳
      </button>
      <input
        aria-label="Address"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onNavigate(draft);
        }}
        disabled={!tab}
        className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[12px] outline-none focus:border-white/25"
      />
    </div>
  );
}
