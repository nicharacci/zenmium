import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Columns2, Home, Plus, Search, SquareArrowOutUpRight } from "lucide-react";
import { CommandPalette, type CommandItem } from "@/components/motion/command-palette";
import { Sidebar } from "./components/Sidebar";
import { useShortcuts } from "./hooks/useShortcuts";
import { ARC_IPC, ARC_STATE_EVENT, emptyState, type ArcState } from "@shared/ipc";

export default function App() {
  const [state, setState] = useState<ArcState>(emptyState());
  const [commandOpen, setCommandOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const invoke = useCallback(
    (channel: string, payload?: unknown) => window.zenmium.invoke(channel, payload),
    [],
  );

  useEffect(() => window.zenmium.on(ARC_STATE_EVENT, (p) => setState(p as ArcState)), []);

  useEffect(() => {
    void invoke(ARC_IPC.snapshot).then((s) => {
      if (s && typeof s === "object" && "spaces" in (s as object)) setState(s as ArcState);
    });
  }, [invoke]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      void invoke(ARC_IPC.setContentBounds, {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("resize", report);
    const timer = window.setInterval(report, 700);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      window.clearInterval(timer);
    };
  }, [invoke]);

  const active = state.tabs.find((t) => t.id === state.activeTabId) ?? null;
  const spaceTabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);

  useShortcuts({ state, invoke, openCommand: () => setCommandOpen(true) });

  const items: CommandItem[] = [
    { id: "new-tab", label: "New Tab", group: "Actions", icon: Plus, onSelect: () => void invoke(ARC_IPC.newTab, {}) },
    { id: "new-space", label: "New Workspace", group: "Actions", icon: Home, onSelect: () => void invoke(ARC_IPC.createSpace, { name: `Workspace ${state.spaces.length + 1}` }) },
    ...(active
      ? [
          {
            id: "pin",
            label: active.kind === "pinned" ? "Remove Essential" : "Add Essential",
            group: "Actions",
            icon: Home,
            onSelect: () => void invoke(active.kind === "pinned" ? ARC_IPC.unpinTab : ARC_IPC.pinTab, active.id),
          },
          { id: "split", label: "Toggle Split View", group: "Actions", icon: Columns2, onSelect: () => void invoke(ARC_IPC.toggleSplit, active.id) },
          { id: "peek", label: "Open in Glance", group: "Actions", icon: SquareArrowOutUpRight, onSelect: () => void invoke(ARC_IPC.openPeek, active.url) },
        ]
      : []),
    {
      id: "clear-today",
      label: "Archive All Today Tabs",
      group: "Actions",
      icon: Archive,
      onSelect: () => {
        for (const tab of state.tabs.filter((t) => t.kind === "today")) void invoke(ARC_IPC.archiveTab, tab.id);
      },
    },
    ...spaceTabs.map((tab) => ({
      id: `tab-${tab.id}`,
      label: tab.title || tab.url,
      group: "Tabs",
      hint: tab.kind === "pinned" ? "Essential" : "Today",
      icon: Search,
      onSelect: () => void invoke(ARC_IPC.activateTab, tab.id),
    })),
  ];

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <Sidebar state={state} invoke={invoke} active={active} onCommand={() => setCommandOpen(true)} />
      <main className="flex min-w-0 flex-1 flex-col">
        <div ref={contentRef} className="min-h-0 flex-1 bg-background" />
      </main>
      <CommandPalette
        items={items}
        shortcut="t"
        placeholder="Search tabs or run a command…"
        open={commandOpen}
        onOpenChange={setCommandOpen}
      />
    </div>
  );
}
