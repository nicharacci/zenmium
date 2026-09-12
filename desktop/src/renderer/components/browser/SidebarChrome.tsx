// biome-ignore-all lint/performance/noJsxPropsBind: These small native controls use current render state; callback identity is not a memoization boundary.
import {
  type BrowserPreferences,
  type BrowserSurfaceProps,
  CHROME_IPC,
} from "@shared/browser-ui";
import { ARC_IPC } from "@shared/ipc";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Menu,
  PanelLeft,
  PanelRight,
  Plus,
  Puzzle,
  RotateCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { ButtonHTMLAttributes, PointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { SidebarTabModel } from "./SidebarTab";

export function SidebarButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className={`zen-chrome-button ${className}`}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

const WWW_PREFIX = /^www\./;

function addressLabel(url?: string) {
  if (!url || url === "about:blank") {
    return "Search or enter address";
  }
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, "") || url;
  } catch {
    return url;
  }
}

export function SidebarToolbar({
  active,
  ui,
  invoke,
}: Pick<BrowserSurfaceProps, "ui" | "invoke"> & { active?: SidebarTabModel }) {
  const compact = ui.preferences.sidebarMode === "compact";
  const SideIcon = ui.preferences.side === "left" ? PanelLeft : PanelRight;
  return (
    <header className="zen-sidebar-header">
      <div
        aria-hidden="true"
        className="zen-window-drag-space"
        data-drag-region=""
      />
      <div aria-label="Browser navigation" className="zen-top" role="toolbar">
        <SidebarButton
          aria-pressed={compact}
          label={compact ? "Disable compact mode" : "Enable compact mode"}
          onClick={() =>
            invoke(CHROME_IPC.preferences, {
              sidebarMode: compact ? "expanded" : "compact",
            })
          }
        >
          <SideIcon size={16} />
        </SidebarButton>
        <span aria-hidden="true" className="zen-top-separator" />
        <SidebarButton
          className="zen-navigation-button"
          disabled={!active?.canGoBack}
          label="Back"
          onClick={() => active && invoke(ARC_IPC.back, active.id)}
        >
          <ArrowLeft size={16} />
        </SidebarButton>
        <SidebarButton
          className="zen-navigation-button"
          disabled={!active?.canGoForward}
          label="Forward"
          onClick={() => active && invoke(ARC_IPC.forward, active.id)}
        >
          <ArrowRight size={16} />
        </SidebarButton>
        <SidebarButton
          className="zen-navigation-button"
          disabled={!active}
          label={active?.loading ? "Stop loading" : "Reload"}
          onClick={() =>
            active &&
            invoke(active.loading ? "arc:stop" : ARC_IPC.reload, active.id)
          }
        >
          {active?.loading ? <X size={16} /> : <RotateCw size={15} />}
        </SidebarButton>
        <span className="zen-top-spacer" />
        <SidebarButton
          className="zen-top-extensions"
          label="Extensions"
          onClick={() => invoke(CHROME_IPC.open, { kind: "extensions" })}
        >
          <Puzzle size={15} />
        </SidebarButton>
        <SidebarButton
          className="zen-top-menu"
          label="Browser menu"
          onClick={() => invoke(CHROME_IPC.open, { kind: "menu" })}
        >
          <Menu size={16} />
        </SidebarButton>
      </div>
      <div className="zen-urlbar-container">
        <button
          aria-expanded={ui.overlay?.kind === "address"}
          aria-haspopup="dialog"
          aria-label="Search or enter address"
          className="zen-urlbar"
          onClick={() =>
            invoke(CHROME_IPC.open, { kind: "address", tabId: active?.id })
          }
          title={active?.url || "Search or enter address"}
          type="button"
        >
          <Search aria-hidden="true" size={14} />
          <span>{addressLabel(active?.url)}</span>
        </button>
      </div>
    </header>
  );
}

export function SidebarNewTab({
  invoke,
  spaceId,
  open,
}: Pick<BrowserSurfaceProps, "invoke"> & { spaceId: string; open: boolean }) {
  return (
    <button
      aria-label="New tab"
      className="zen-new-tab"
      data-in-urlbar={open}
      onClick={() => invoke(CHROME_IPC.open, { kind: "new-tab", spaceId })}
      title="New tab (⌘T)"
      type="button"
    >
      <Plus aria-hidden="true" size={16} />
      <span>New Tab</span>
    </button>
  );
}

export function SidebarFootActions({
  ui,
  invoke,
}: Pick<BrowserSurfaceProps, "ui" | "invoke">) {
  const expanded = ui.preferences.sidebarMode === "expanded";
  const SideIcon = ui.preferences.side === "left" ? PanelLeft : PanelRight;
  return (
    <div
      aria-label="Sidebar actions"
      className="zen-foot-actions"
      role="toolbar"
    >
      <SidebarButton
        label={expanded ? "Collapse sidebar" : "Keep sidebar expanded"}
        onClick={() =>
          invoke(CHROME_IPC.preferences, {
            sidebarMode: expanded ? "collapsed" : "expanded",
          })
        }
      >
        <SideIcon size={15} />
      </SidebarButton>
      <SidebarButton
        label="Downloads"
        onClick={() => invoke(CHROME_IPC.open, { kind: "downloads" })}
      >
        <Download size={15} />
      </SidebarButton>
      <SidebarButton
        label="New workspace"
        onClick={() => invoke(CHROME_IPC.open, { kind: "workspace-edit" })}
      >
        <Plus size={16} />
      </SidebarButton>
      <span className="zen-foot-spacer" />
      <SidebarButton
        label="Agent"
        onClick={() => invoke(CHROME_IPC.open, { kind: "agent" })}
      >
        <Sparkles size={15} />
      </SidebarButton>
      <SidebarButton
        label="Browser menu"
        onClick={() => invoke(CHROME_IPC.open, { kind: "menu" })}
      >
        <Menu size={15} />
      </SidebarButton>
    </div>
  );
}

export function SidebarResize({
  preferences,
  invoke,
  setDragging,
}: Pick<BrowserSurfaceProps, "invoke"> & {
  preferences: BrowserPreferences;
  setDragging: (value: boolean) => void;
}) {
  const pointer = useRef<{ x: number; width: number } | null>(null);
  const frame = useRef<number | null>(null);
  const pendingWidth = useRef(preferences.width);
  const [resizing, setResizing] = useState(false);
  const persist = (width: number) =>
    invoke(CHROME_IPC.preferences, {
      width: Math.max(200, Math.min(420, Math.round(width))),
    });
  const finish = () => {
    if (!pointer.current) {
      return;
    }
    pointer.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
    }
    frame.current = null;
    persist(pendingWidth.current);
    setResizing(false);
    setDragging(false);
  };
  useEffect(
    () => () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
      if (pointer.current) {
        setDragging(false);
      }
    },
    [setDragging]
  );
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointer.current) {
      return;
    }
    // screenX stays stable when a right-side native view changes its origin.
    const delta =
      (event.screenX - pointer.current.x) *
      (preferences.side === "left" ? 1 : -1);
    pendingWidth.current = Math.max(
      200,
      Math.min(420, pointer.current.width + delta)
    );
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        persist(pendingWidth.current);
      });
    }
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: The APG window splitter is interactive and resizable, not a static horizontal rule.
    <div
      aria-label="Sidebar width"
      aria-orientation="vertical"
      aria-valuemax={420}
      aria-valuemin={200}
      aria-valuenow={preferences.width}
      className="zen-sidebar-splitter"
      data-resizing={resizing}
      onDoubleClick={() => persist(230)}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const direction =
          (event.key === "ArrowRight" ? 1 : -1) *
          (preferences.side === "left" ? 1 : -1);
        let width = preferences.width + direction * 10;
        if (event.key === "Home") {
          width = 200;
        }
        if (event.key === "End") {
          width = 420;
        }
        persist(width);
      }}
      onLostPointerCapture={finish}
      onPointerCancel={finish}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = { width: preferences.width, x: event.screenX };
        pendingWidth.current = preferences.width;
        setResizing(true);
        setDragging(true);
      }}
      onPointerMove={move}
      onPointerUp={finish}
      role="separator"
      tabIndex={0}
    />
  );
}
