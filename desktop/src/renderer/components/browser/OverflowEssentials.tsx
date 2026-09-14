import { CHROME_IPC, type Invoke } from "@shared/browser-ui";
import { ARC_IPC, type Tab } from "@shared/ipc";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { TabIcon, tabTitle } from "./SurfacePrimitives";

/** Real overflow pins, not a second bookmark store or an empty toolbar. */
export function OverflowEssentials({ tabs, activeTabId, invoke, style }: {
  tabs: Tab[];
  activeTabId: string | null;
  invoke: Invoke;
  style: CSSProperties;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => setEdges({ start: node.scrollLeft <= 1, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 1 });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    node.addEventListener("scroll", measure);
    measure();
    return () => { observer.disconnect(); node.removeEventListener("scroll", measure); };
  }, [tabs]);
  if (!tabs.length) return null;
  const scroll = (direction: number) => list.current?.scrollBy({
    left: direction * Math.max(120, list.current.clientWidth * 0.7),
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
  return (
    <nav aria-label="Overflow essentials" className="zen-bookmarks-bar" style={style}>
      {!edges.start && <button aria-label="Scroll essentials left" className="zen-overflow-arrow" onClick={() => scroll(-1)} type="button"><ChevronLeft size={14} /></button>}
      <div className="zen-overflow-chips" ref={list}>
        {tabs.map((tab) => (
          <button aria-current={tab.id === activeTabId ? "page" : undefined}
            key={tab.id} title={tabTitle(tab)} type="button"
            onClick={() => void invoke(ARC_IPC.activateTab, tab.id)}
            onContextMenu={(event) => { event.preventDefault(); void invoke(CHROME_IPC.open, {kind: "tab-menu", tabId: tab.id, x: event.clientX, y: event.clientY + 8 }); }}>
            <TabIcon tab={tab} /><span>{tabTitle(tab)}</span>
          </button>
        ))}
      </div>
      {!edges.end && <button aria-label="Scroll essentials right" className="zen-overflow-arrow" onClick={() => scroll(1)} type="button"><ChevronRight size={14} /></button>}
    </nav>
  );
}
