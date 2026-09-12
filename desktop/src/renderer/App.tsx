import { useCallback, useEffect, useRef, useState } from "react";
import { AddressBar } from "./components/AddressBar";
import { CommandBar } from "./components/CommandBar";
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

  useShortcuts({
    state,
    invoke,
    openCommand: () => setCommandOpen(true),
  });

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      <Sidebar state={state} invoke={invoke} onCommand={() => setCommandOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AddressBar
          tab={active}
          title={active?.title ?? ""}
          url={active?.url ?? ""}
          loading={active?.loading ?? false}
          onNavigate={(url) => active && void invoke(ARC_IPC.navigate, { id: active.id, url })}
          onBack={() => active && void invoke(ARC_IPC.back, active.id)}
          onForward={() => active && void invoke(ARC_IPC.forward, active.id)}
          onReload={() => active && void invoke(ARC_IPC.reload, active.id)}
          onPin={() => active && void invoke(active.id ? (state.tabs.find((t) => t.id === active.id)?.kind === "pinned" ? ARC_IPC.unpinTab : ARC_IPC.pinTab) : "", active.id)}
        />
        <div ref={contentRef} className="min-h-0 flex-1 bg-[var(--gp-panel)]" />
      </div>
      {commandOpen ? (
        <CommandBar
          state={state}
          invoke={invoke}
          onClose={() => setCommandOpen(false)}
        />
      ) : null}
    </div>
  );
}
