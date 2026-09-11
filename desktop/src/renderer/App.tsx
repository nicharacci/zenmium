import { useCallback, useEffect, useRef, useState } from "react";
import { AddressBar } from "./components/AddressBar";
import { Sidebar } from "./components/Sidebar";
import { TabStrip } from "./components/TabStrip";
import { BROWSER_EVENT_CHANNEL, BROWSER_IPC, type BrowserEvent, type BrowserTab } from "@shared/ipc";

export default function App() {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const invoke = useCallback(
    (channel: string, payload?: unknown) => window.zenmium.invoke(channel, payload),
    [],
  );

  useEffect(() => {
    return window.zenmium.on(BROWSER_EVENT_CHANNEL, (payload) => {
      const event = payload as BrowserEvent;
      if (event.type === "tabs") {
        setTabs(event.tabs);
        setActiveId(event.activeId);
      } else if (event.type === "active") {
        setActiveId(event.activeId);
      } else if (event.type === "loading") {
        setTabs((rows) => rows.map((t) => (t.id === event.id ? { ...t, loading: event.loading } : t)));
      } else if (event.type === "url") {
        setTabs((rows) => rows.map((t) => (t.id === event.id ? { ...t, url: event.url } : t)));
      }
    });
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      void invoke(BROWSER_IPC.setContentBounds, {
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
    const timer = window.setInterval(report, 800);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      window.clearInterval(timer);
    };
  }, [invoke]);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const select = (id: string) => void invoke(BROWSER_IPC.activateTab, { id });
  const close = (id: string) => void invoke(BROWSER_IPC.closeTab, { id });
  const newTab = (url?: string) => void invoke(BROWSER_IPC.createTab, url ? { url } : {});

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar tabs={tabs} activeId={activeId} onSelect={select} onClose={close} onNewTab={() => newTab()} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TabStrip tabs={tabs} activeId={activeId} onSelect={select} onClose={close} onNew={() => newTab()} />
        <AddressBar
          tab={active}
          onNavigate={(url) => active && void invoke(BROWSER_IPC.navigate, { id: active.id, url })}
          onBack={() => active && void invoke(BROWSER_IPC.back, { id: active.id })}
          onForward={() => active && void invoke(BROWSER_IPC.forward, { id: active.id })}
          onReload={() => active && void invoke(BROWSER_IPC.reload, { id: active.id })}
        />
        <div ref={contentRef} className="min-h-0 flex-1 bg-[var(--gp-panel)]" />
      </div>
    </div>
  );
}
