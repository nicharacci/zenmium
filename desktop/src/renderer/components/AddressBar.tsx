import { useEffect, useState } from "react";
import type { Tab } from "@shared/ipc";

export function AddressBar({
  tab,
  title,
  url,
  loading,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onPin,
}: {
  tab: Tab | null;
  title: string;
  url: string;
  loading: boolean;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onPin: () => void;
}) {
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(url);
  }, [url, editing]);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 px-3" data-address-bar="">
      <div className="flex items-center gap-0.5 text-[var(--gp-muted)]">
        <button type="button" aria-label="Back" onClick={onBack} className="rounded-md px-2 py-1 hover:bg-white/10">
          ‹
        </button>
        <button type="button" aria-label="Forward" onClick={onForward} className="rounded-md px-2 py-1 hover:bg-white/10">
          ›
        </button>
        <button type="button" aria-label="Reload" onClick={onReload} className="rounded-md px-2 py-1 hover:bg-white/10">
          {loading ? "×" : "⟳"}
        </button>
      </div>
      <input
        data-address-input=""
        aria-label="Address"
        value={draft}
        disabled={!tab}
        onFocus={() => {
          setEditing(true);
          setDraft(url);
        }}
        onBlur={() => setEditing(false)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onNavigate(draft);
            (event.target as HTMLInputElement).blur();
          } else if (event.key === "Escape") {
            setDraft(url);
            (event.target as HTMLInputElement).blur();
          }
        }}
        className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/25 px-4 py-1.5 text-center text-[12.5px] outline-none focus:border-white/25 focus:text-left"
      />
      <button
        type="button"
        aria-label={tab?.kind === "pinned" ? "Unpin" : "Pin"}
        onClick={onPin}
        disabled={!tab}
        className="rounded-md px-2 py-1 text-[var(--gp-muted)] hover:bg-white/10 disabled:opacity-40"
      >
        ⌂
      </button>
      <span className="hidden truncate text-[11px] text-[var(--gp-muted)] sm:block" style={{ maxWidth: 160 }}>
        {title}
      </span>
    </div>
  );
}
