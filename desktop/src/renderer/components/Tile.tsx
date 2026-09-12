import { useEffect, useState } from "react";
import type { Tab } from "@shared/ipc";

const LETTER_COLORS = [
  "#6ee7a8",
  "#8ab4f8",
  "#f6a5c0",
  "#f5c26b",
  "#c4a7f5",
  "#7fd6d6",
  "#f58f8f",
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function Tile({ tab, size = 26 }: { tab: Tab; size?: number }) {
  const letter = (hostOf(tab.url)[0] ?? "•").toUpperCase();
  let hash = 0;
  for (const ch of tab.url) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  const color = LETTER_COLORS[hash % LETTER_COLORS.length]!;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md font-semibold text-black/80"
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
      data-tile=""
    >
      {tab.loading ? "·" : letter}
    </span>
  );
}

export function Row({
  tab,
  active,
  collapsed,
  onActivate,
  onClose,
  onPin,
  onUnpin,
}: {
  tab: Tab;
  active: boolean;
  collapsed: boolean;
  onActivate: () => void;
  onClose: () => void;
  onPin: () => void;
  onUnpin: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      data-active={active ? "true" : "false"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`group flex h-9 items-center gap-2 rounded-lg px-2 text-[12.5px] transition-colors ${
        active ? "bg-white/12 text-[var(--gp-ink)]" : "text-[var(--gp-muted)] hover:bg-white/7"
      }`}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onActivate}>
        <Tile tab={tab} />
        {collapsed ? null : <span className="min-w-0 flex-1 truncate">{tab.title || hostOf(tab.url)}</span>}
      </button>
      {collapsed || !hover ? null : (
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={tab.kind === "pinned" ? "Unpin" : "Pin"}
            className="rounded px-1 text-[var(--gp-muted)] hover:bg-white/15"
            onClick={tab.kind === "pinned" ? onUnpin : onPin}
          >
            ⌂
          </button>
          <button
            type="button"
            aria-label="Close tab"
            className="rounded px-1 text-[var(--gp-muted)] hover:bg-white/15"
            onClick={onClose}
          >
            ×
          </button>
        </span>
      )}
    </div>
  );
}
