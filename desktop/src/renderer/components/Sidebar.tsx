import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderPlus,
  Globe2,
  GripVertical,
  Menu,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pencil,
  Pin,
  Plus,
  Puzzle,
  RotateCcw,
  RotateCw,
  Search,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AgentRail } from "@/components/AgentRail";
import { getFaviconUrl } from "@/lib/favicon";
import { ARC_IPC, type ArcState, type Tab, type TabUpdate } from "@shared/ipc";

type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

const DEFAULT_WIDTH = 230;
const COLLAPSED_WIDTH = 60;
const MAX_ESSENTIALS = 12;

type ContextMenuState = { tabId: string; x: number; y: number };
type EditorState = { tabId: string; kind: "url" | "icon"; value: string };
type DragOverState = { targetId: string; position: "before" | "after" | "inside" };

function readBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = Number(window.localStorage.getItem(key));
    return Number.isFinite(stored) && stored >= 180 && stored <= 420 ? stored : fallback;
  } catch {
    return fallback;
  }
}

function readSide(): "left" | "right" {
  if (typeof window === "undefined") return "left";
  try {
    return window.localStorage.getItem("zen.sidebar.side") === "right" ? "right" : "left";
  } catch {
    return "left";
  }
}

function Favicon({ url, iconUrl, size = 16 }: { url: string; iconUrl?: string; size?: number }) {
  const src = iconUrl || getFaviconUrl(url);
  if (!src) {
    return (
      <span
        aria-hidden="true"
        className="zen-tab-icon zen-tab-icon-fallback"
        style={{ width: size, height: size }}
      >
        <Globe2 size={Math.max(10, size - 4)} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="zen-tab-icon"
      style={{ width: size, height: size }}
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

function StatusMark({ tab }: { tab: Tab }) {
  if (tab.muted) return <VolumeX aria-label="Muted" className="zen-tab-status" size={13} />;
  if (tab.audio) return <Volume2 aria-label="Playing audio" className="zen-tab-status" size={13} />;
  if (tab.blocked) return <span aria-label="Blocked" className="zen-tab-status zen-tab-status-text">!</span>;
  return null;
}

export function Sidebar({
  state,
  invoke,
  active,
  onCommand,
}: {
  state: ArcState;
  invoke: Invoke;
  active: Tab | null;
  onCommand: () => void;
}) {
  const [expanded, setExpanded] = useState(() => readBoolean("zen.sidebar.expanded", true));
  const [compactMode, setCompactMode] = useState(() => readBoolean("zen.sidebar.compact", true));
  const [userShow, setUserShow] = useState(false);
  const [hasHover, setHasHover] = useState(false);
  const [side, setSide] = useState<"left" | "right">(readSide);
  const [width, setWidth] = useState(() => readNumber("zen.sidebar.width", DEFAULT_WIDTH));
  const [newTabAtTop, setNewTabAtTop] = useState(() => readBoolean("zen.sidebar.newTabTop", false));
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const [essentialsOpen, setEssentialsOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sidebarMenuOpen, setSidebarMenuOpen] = useState(false);
  const [draft, setDraft] = useState(active?.url ?? "");
  const [editingAddress, setEditingAddress] = useState(false);
  const [agentOpen] = useState(false);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<DragOverState | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [renameTabId, setRenameTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sidebarMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);

  const currentSpace = state.spaces.find((space) => space.id === state.activeSpaceId) ?? state.spaces[0];
  const tabs = useMemo(
    () => state.tabs.filter((tab) => tab.spaceId === state.activeSpaceId),
    [state.activeSpaceId, state.tabs],
  );
  const folders = useMemo(
    () => state.folders.filter((folder) => folder.spaceId === state.activeSpaceId),
    [state.activeSpaceId, state.folders],
  );
  const essentials = useMemo(
    () => tabs.filter((tab) => tab.kind === "pinned" && !tab.folderId),
    [tabs],
  );
  const normalTabs = useMemo(
    () => tabs.filter((tab) => tab.kind === "today" && !tab.folderId),
    [tabs],
  );
  const folderTabs = useMemo(
    () => new Map(folders.map((folder) => [folder.id, tabs.filter((tab) => tab.folderId === folder.id)])),
    [folders, tabs],
  );
  const orderedTabs = useMemo(
    () => [...normalTabs, ...folders.flatMap((folder) => folderTabs.get(folder.id) ?? [])],
    [folderTabs, folders, normalTabs],
  );
  const selectedTab = contextMenu ? state.tabs.find((tab) => tab.id === contextMenu.tabId) ?? null : null;
  const visible = !compactMode || hasHover || userShow;
  const visuallyExpanded = expanded || hasHover;
  const addressHasTab = Boolean(active);

  useEffect(() => {
    if (!editingAddress) setDraft(active?.url ?? "");
  }, [active?.url, editingAddress]);

  useEffect(() => {
    window.localStorage.setItem("zen.sidebar.expanded", String(expanded));
  }, [expanded]);
  useEffect(() => {
    window.localStorage.setItem("zen.sidebar.compact", String(compactMode));
  }, [compactMode]);
  useEffect(() => {
    window.localStorage.setItem("zen.sidebar.side", side);
  }, [side]);
  useEffect(() => {
    window.localStorage.setItem("zen.sidebar.width", String(width));
  }, [width]);
  useEffect(() => {
    window.localStorage.setItem("zen.sidebar.newTabTop", String(newTabAtTop));
  }, [newTabAtTop]);

  useEffect(() => {
    const element = tabsRef.current;
    if (!element) return;
    const measure = () => setTabsOverflow(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [collapsedFolders, folders, normalTabs, newTabAtTop, tabs]);

  useEffect(() => {
    if (!compactMode) {
      setHasHover(false);
      setUserShow(false);
      return;
    }
    const reveal = () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      setHasHover(true);
    };
    const scheduleHide = () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => setHasHover(false), 150);
    };
    const onPointerMove = (event: PointerEvent) => {
      const nearEdge = side === "left" ? event.clientX <= 200 : event.clientX >= window.innerWidth - 200;
      if (nearEdge && event.clientY <= 100) reveal();
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      scheduleHide();
    };
  }, [compactMode, side]);

  useEffect(() => {
    if (!contextMenu && !sidebarMenuOpen && !workspaceOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (contextMenu && !menuRef.current?.contains(event.target)) {
        setContextMenu(null);
        setEditor(null);
      }
      if (sidebarMenuOpen && !sidebarMenuRef.current?.contains(event.target)) setSidebarMenuOpen(false);
      if (workspaceOpen && !workspaceMenuRef.current?.contains(event.target)) setWorkspaceOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [contextMenu, sidebarMenuOpen, workspaceOpen]);

  useEffect(() => {
    if (!renameTabId) return;
    const frame = window.requestAnimationFrame(() => renameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [renameTabId]);

  const reveal = () => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    setHasHover(true);
  };
  const hide = () => {
    if (!compactMode) return;
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setHasHover(false), 150);
  };

  const updateTab = (id: string, patch: TabUpdate) => {
    void invoke(ARC_IPC.updateTab, { id, patch });
  };

  const navigate = () => {
    const value = draft.trim();
    if (!value) return;
    if (active) void invoke(ARC_IPC.navigate, { id: active.id, url: value });
    else void invoke(ARC_IPC.newTab, { url: value });
    inputRef.current?.blur();
  };

  const finishRename = () => {
    if (!renameTabId) return;
    if (renameValue.trim()) updateTab(renameTabId, { title: renameValue.trim() });
    setRenameTabId(null);
  };

  const startRename = (tab: Tab) => {
    setRenameTabId(tab.id);
    setRenameValue(tab.title || tab.url);
    setContextMenu(null);
    setEditor(null);
  };

  const openEditor = (tab: Tab, kind: EditorState["kind"]) => {
    setEditor({ tabId: tab.id, kind, value: kind === "url" ? tab.url : tab.iconUrl ?? "" });
  };

  const saveEditor = (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    const value = editor.value.trim();
    if (editor.kind === "url" && value) updateTab(editor.tabId, { url: value });
    if (editor.kind === "icon") {
      const tab = state.tabs.find((candidate) => candidate.id === editor.tabId);
      updateTab(editor.tabId, {
        iconUrl: value || null,
        originalIconUrl: tab?.originalIconUrl ?? null,
        pinnedChanged: Boolean(value),
      });
    }
    setEditor(null);
    setContextMenu(null);
  };

  const beginDrag = (event: ReactDragEvent, tab: Tab) => {
    setDraggingTabId(tab.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tab.id);
  };

  const clearDrag = () => {
    setDraggingTabId(null);
    setDragOver(null);
  };

  const dragIdFrom = (event: ReactDragEvent) => draggingTabId ?? event.dataTransfer.getData("text/plain");

  const handleTabDragOver = (event: ReactDragEvent, tab: Tab) => {
    const sourceId = dragIdFrom(event);
    if (!sourceId || sourceId === tab.id) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    setDragOver({ targetId: tab.id, position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" });
  };

  const handleTabDrop = (event: ReactDragEvent, target: Tab) => {
    event.preventDefault();
    const sourceId = dragIdFrom(event);
    if (!sourceId || sourceId === target.id) return clearDrag();
    const position = dragOver?.targetId === target.id ? dragOver.position : "before";
    const targetIndex = orderedTabs.findIndex((tab) => tab.id === target.id);
    const beforeId = position === "before" ? target.id : orderedTabs[targetIndex + 1]?.id ?? null;
    void invoke(ARC_IPC.reorderTab, { id: sourceId, beforeId });
    clearDrag();
  };

  const handleEssentialsDrop = (event: ReactDragEvent) => {
    event.preventDefault();
    const sourceId = dragIdFrom(event);
    const source = state.tabs.find((tab) => tab.id === sourceId);
    if (!source || (essentials.length >= MAX_ESSENTIALS && source.kind !== "pinned")) return clearDrag();
    void invoke(ARC_IPC.pinTab, source.id);
    void invoke(ARC_IPC.moveToFolder, { id: source.id, folderId: null });
    clearDrag();
  };

  const handleFolderDrop = (event: ReactDragEvent, folderId: string) => {
    event.preventDefault();
    const sourceId = dragIdFrom(event);
    if (!sourceId) return clearDrag();
    void invoke(ARC_IPC.moveToFolder, { id: sourceId, folderId });
    clearDrag();
  };

  const showContextMenu = (event: ReactMouseEvent, tab: Tab) => {
    event.preventDefault();
    const menuWidth = 276;
    const menuHeight = 420;
    setContextMenu({
      tabId: tab.id,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight)),
    });
    setEditor(null);
  };

  const toggleEssential = (tab: Tab) => {
    const isEssential = tab.kind === "pinned" && !tab.folderId;
    if (isEssential) {
      void invoke(ARC_IPC.unpinTab, tab.id);
    } else if (tab.kind === "pinned") {
      void invoke(ARC_IPC.moveToFolder, { id: tab.id, folderId: null });
    } else if (essentials.length < MAX_ESSENTIALS) {
      void invoke(ARC_IPC.pinTab, tab.id);
    }
    setContextMenu(null);
  };

  const renderTab = (tab: Tab, options: { essential?: boolean; nested?: boolean } = {}) => {
    const isEssential = Boolean(options.essential);
    const isActive = tab.id === state.activeTabId;
    const isRenaming = renameTabId === tab.id;
    const tabStyle = tab.containerColor
      ? ({ "--zen-container-color": tab.containerColor } as CSSProperties)
      : undefined;
    const leading = (
      <span className="zen-tab-leading">
        <span className="zen-tab-icon-stack">
          <Favicon url={tab.url} iconUrl={tab.iconUrl} size={isEssential ? 22 : 16} />
          <StatusMark tab={tab} />
        </span>
      </span>
    );
    const pinnedReset = tab.pinnedChanged ? (
      <button
        type="button"
        className="zen-pinned-reset"
        title="Reset pinned icon"
        aria-label="Reset pinned icon"
        onClick={(event) => {
          event.stopPropagation();
          updateTab(tab.id, { iconUrl: null, pinnedChanged: false });
        }}
      >
        <Favicon url={tab.originalIconUrl ?? tab.url} size={12} />
      </button>
    ) : null;

    if (isEssential) {
      return (
        <div
          key={tab.id}
          className="zen-essential"
          data-active={isActive ? "true" : "false"}
          data-dragging={draggingTabId === tab.id ? "true" : "false"}
          data-pinned-changed={tab.pinnedChanged ? "true" : "false"}
          title={tab.title || tab.url}
          draggable
          onDragStart={(event) => beginDrag(event, tab)}
          onDragEnd={clearDrag}
          onContextMenu={(event) => showContextMenu(event, tab)}
        >
          <button
            type="button"
            className="zen-essential-hit"
            aria-label={tab.title || tab.url}
            onClick={() => void invoke(ARC_IPC.activateTab, tab.id)}
          >
            {leading}
          </button>
          {tab.pinnedChanged ? (
            <button
              type="button"
              className="zen-essential-reset"
              title="Reset pinned icon"
              aria-label="Reset pinned icon"
              onClick={() => updateTab(tab.id, { iconUrl: null, pinnedChanged: false })}
            >
              <RotateCcw size={11} />
            </button>
          ) : null}
        </div>
      );
    }

    return (
      <div
        key={tab.id}
        className="zen-tab"
        data-active={isActive ? "true" : "false"}
        data-pending={tab.loading ? "true" : "false"}
        data-discarded={tab.discarded ? "true" : "false"}
        data-glance={tab.glance ? "true" : "false"}
        data-muted={tab.muted ? "true" : "false"}
        data-blocked={tab.blocked ? "true" : "false"}
        data-nested={options.nested ? "true" : "false"}
        style={tabStyle}
        draggable={!isRenaming}
        onDragStart={(event) => beginDrag(event, tab)}
        onDragEnd={clearDrag}
        onDragOver={(event) => handleTabDragOver(event, tab)}
        onDrop={(event) => handleTabDrop(event, tab)}
        onContextMenu={(event) => showContextMenu(event, tab)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          startRename(tab);
        }}
      >
        {tab.containerColor ? <span aria-hidden="true" className="zen-container-line" /> : null}
        <button
          type="button"
          className="zen-tab-main"
          title={tab.title || tab.url}
          onClick={() => void invoke(ARC_IPC.activateTab, tab.id)}
        >
          {leading}
          {tab.glance ? <span className="zen-glance-note" aria-label="Glance tab">↗</span> : null}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="zen-tab-rename"
              value={renameValue}
              aria-label="Rename tab"
              onChange={(event) => setRenameValue(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") finishRename();
                if (event.key === "Escape") setRenameTabId(null);
              }}
              onBlur={finishRename}
            />
          ) : (
            <span className="zen-tab-copy">
              <span className="zen-tab-label">{tab.title || tab.url}</span>
              {tab.sublabel ? <span className="zen-tab-sublabel">{tab.sublabel}</span> : null}
            </span>
          )}
        </button>
        {pinnedReset}
        {!isRenaming && tab.kind !== "pinned" ? (
          <button
            type="button"
            aria-label="Close tab"
            className="zen-tab-close"
            onClick={() => void invoke(ARC_IPC.closeTab, tab.id)}
          >
            <X size={14} />
          </button>
        ) : null}
        {dragOver?.targetId === tab.id && dragOver.position === "after" ? <span className="zen-drag-indicator" /> : null}
      </div>
    );
  };

  return (
    <>
      {compactMode || !expanded ? (
        <div
          aria-hidden="true"
          className="zen-edge-zone"
          data-side={side}
          data-collapsed={!expanded ? "true" : undefined}
          onMouseEnter={reveal}
          onMouseLeave={hide}
        />
      ) : null}
      <aside
        className="zen-sidebar"
        data-side={side}
        data-expanded={visuallyExpanded ? "true" : "false"}
        data-persistent-expanded={expanded ? "true" : "false"}
        data-compact-visible={visible ? "true" : "false"}
        data-open={expanded ? "true" : "false"}
        style={{ "--zen-sidebar-width": `${visuallyExpanded ? width : COLLAPSED_WIDTH}px` } as CSSProperties}
        onMouseEnter={reveal}
        onMouseLeave={hide}
        zen-sidebar-expanded={expanded ? "true" : undefined}
        zen-compact-mode={compactMode ? "true" : undefined}
        zen-has-hover={hasHover ? "true" : undefined}
        zen-user-show={userShow ? "true" : undefined}
      >
        <div className="zen-sidebar-content">
          <div className="zen-top" data-drag-region="">
            <button
              type="button"
              aria-label={compactMode ? "Disable compact mode" : "Enable compact mode"}
              className="zen-top-btn"
              onClick={() => {
                setCompactMode((value) => !value);
                setUserShow(true);
              }}
            >
              {compactMode ? <PanelLeft size={16} /> : <PanelRight size={16} />}
            </button>
            <span className="zen-top-separator" aria-hidden="true" />
            <button
              type="button"
              aria-label="Back"
              className="zen-top-btn"
              disabled={!active}
              onClick={() => active && void invoke(ARC_IPC.back, active.id)}
            >
              <ArrowLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="Forward"
              className="zen-top-btn"
              disabled={!active}
              onClick={() => active && void invoke(ARC_IPC.forward, active.id)}
            >
              <ArrowRight size={16} />
            </button>
            <button
              type="button"
              aria-label="Reload"
              className="zen-top-btn"
              disabled={!active}
              onClick={() => active && void invoke(ARC_IPC.reload, active.id)}
            >
              <RotateCw size={15} />
            </button>
            <span className="zen-top-spacer" />
            <button type="button" aria-label="Extensions" className="zen-top-btn" title="Extensions">
              <Puzzle size={16} />
            </button>
            <button
              type="button"
              aria-label="Sidebar menu"
              className="zen-top-btn"
              onClick={() => setSidebarMenuOpen((value) => !value)}
            >
              <Menu size={16} />
            </button>
          </div>

          <div className="zen-urlbar-container">
            <Search className="zen-urlbar-search" size={14} aria-hidden="true" />
            <input
              ref={inputRef}
              data-address-input=""
              aria-label="Address"
              className="zen-urlbar"
              value={draft}
              disabled={!addressHasTab && state.tabs.length === 0}
              placeholder="Search or enter address"
              onFocus={() => {
                setExpanded(true);
                setEditingAddress(true);
                setDraft(active?.url ?? "");
              }}
              onBlur={() => setEditingAddress(false)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") navigate();
                if (event.key === "Escape") {
                  setDraft(active?.url ?? "");
                  inputRef.current?.blur();
                }
              }}
            />
            <button
              type="button"
              aria-label="New tab"
              className="zen-urlbar-action"
              onClick={() => void invoke(ARC_IPC.newTab, {})}
            >
              <Plus size={15} />
            </button>
          </div>

          <section
            className="zen-essentials-section"
            aria-label="Essentials"
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver({ targetId: "__essentials__", position: "inside" });
            }}
            onDragLeave={() => setDragOver((value) => (value?.targetId === "__essentials__" ? null : value))}
            onDrop={handleEssentialsDrop}
          >
            <div className="zen-section-heading">
              <span>Essentials</span>
              <span className="zen-section-count">{essentials.length}/{MAX_ESSENTIALS}</span>
              <button
                type="button"
                className="zen-section-toggle"
                aria-label={essentialsOpen ? "Collapse essentials" : "Expand essentials"}
                onClick={() => setEssentialsOpen((value) => !value)}
              >
                <ChevronDown size={13} className={essentialsOpen ? "" : "-rotate-90"} />
              </button>
            </div>
            {essentialsOpen ? (
              essentials.length > 0 ? (
                <div className="zen-essentials" data-dragover={dragOver?.targetId === "__essentials__" ? "true" : "false"}>
                  {essentials.map((tab) => renderTab(tab, { essential: true }))}
                </div>
              ) : (
                <div
                  className="zen-essentials-promo"
                  data-dragover={dragOver?.targetId === "__essentials__" ? "true" : "false"}
                >
                  <Pin size={14} />
                  <span>Drop tabs here to pin</span>
                </div>
              )
            ) : null}
          </section>

          <section
            className="zen-tabs-section"
            aria-label="Tabs"
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragOver(null);
            }}
          >
            <div className="zen-section-heading zen-tabs-heading">
              <span>Tabs</span>
              <span className="zen-section-count">{normalTabs.length + folders.reduce((sum, folder) => sum + (folderTabs.get(folder.id)?.length ?? 0), 0)}</span>
            </div>
            <div ref={tabsRef} className="zen-tabs" data-overflow={tabsOverflow ? "true" : "false"}>
              {newTabAtTop ? (
                <button type="button" className="zen-new-tab" onClick={() => void invoke(ARC_IPC.newTab, {})}>
                  <Plus size={15} />
                  <span>New tab</span>
                </button>
              ) : null}
              {normalTabs.map((tab) => (
                <span key={tab.id} className="zen-tab-slot">
                  {dragOver?.targetId === tab.id && dragOver.position === "before" ? <span className="zen-drag-indicator" /> : null}
                  {renderTab(tab)}
                </span>
              ))}
              {folders.map((folder) => {
                const children = folderTabs.get(folder.id) ?? [];
                const isCollapsed = collapsedFolders.has(folder.id) || folder.collapsed;
                return (
                  <div
                    key={folder.id}
                    className="zen-folder"
                    data-collapsed={isCollapsed ? "true" : "false"}
                    data-dragover={dragOver?.targetId === folder.id ? "true" : "false"}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOver({ targetId: folder.id, position: "inside" });
                    }}
                    onDrop={(event) => handleFolderDrop(event, folder.id)}
                  >
                    <button
                      type="button"
                      className="zen-folder-heading"
                      onClick={() =>
                        setCollapsedFolders((current) => {
                          const next = new Set(current);
                          if (next.has(folder.id)) next.delete(folder.id);
                          else next.add(folder.id);
                          return next;
                        })
                      }
                      onDoubleClick={() => {
                        const name = window.prompt("Rename folder", folder.name);
                        if (name?.trim()) void invoke(ARC_IPC.renameFolder, { id: folder.id, name: name.trim() });
                      }}
                    >
                      <ChevronRight size={13} className={!isCollapsed ? "rotate-90" : ""} />
                      <Folder size={14} />
                      <span className="zen-folder-label">{folder.name}</span>
                      <span className="zen-section-count">{children.length}</span>
                    </button>
                    {!isCollapsed
                      ? children.map((tab) => (
                          <span key={tab.id} className="zen-tab-slot zen-folder-tab-slot">
                            {dragOver?.targetId === tab.id && dragOver.position === "before" ? <span className="zen-drag-indicator" /> : null}
                            {renderTab(tab, { nested: true })}
                          </span>
                        ))
                      : null}
                  </div>
                );
              })}
              {normalTabs.length === 0 && folders.length === 0 ? (
                <div className="zen-tabs-empty">
                  <GripVertical size={14} />
                  <span>New tabs appear here</span>
                </div>
              ) : null}
              {!newTabAtTop ? (
                <button type="button" className="zen-new-tab" onClick={() => void invoke(ARC_IPC.newTab, {})}>
                  <Plus size={15} />
                  <span>New tab</span>
                </button>
              ) : null}
            </div>
          </section>

          <div className="zen-agent-shell" data-agent-open={agentOpen ? "true" : "false"}>
            <AgentRail invoke={invoke} />
          </div>

          <div className="zen-workspace-indicator" ref={workspaceMenuRef}>
            <button
              type="button"
              className="zen-current-workspace"
              aria-label={currentSpace ? `Open ${currentSpace.name} workspace switcher` : "Workspace switcher"}
              onClick={() => setWorkspaceOpen((value) => !value)}
            >
              <span className="zen-workspace-icon" style={{ color: currentSpace?.color }}>
                {currentSpace?.icon ?? "◎"}
              </span>
              <span className="zen-current-workspace-copy">
                <span className="zen-current-workspace-name">{currentSpace?.name ?? "Workspace"}</span>
                <span className="zen-current-workspace-subtitle">{essentials.length} essentials</span>
              </span>
              <span className="zen-workspace-actions">
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={essentialsOpen ? "Collapse pinned tabs" : "Expand pinned tabs"}
                  className="zen-workspace-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEssentialsOpen((value) => !value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setEssentialsOpen((value) => !value);
                  }}
                >
                  <ChevronDown size={14} className={essentialsOpen ? "" : "-rotate-90"} />
                </span>
                <span className="zen-workspace-action" aria-hidden="true">
                  <MoreHorizontal size={14} />
                </span>
              </span>
            </button>
            {workspaceOpen ? (
              <div className="zen-workspace-popover" role="menu">
                <div className="zen-popover-title">Workspaces</div>
                {state.spaces.map((space) => (
                  <button
                    key={space.id}
                    type="button"
                    className="zen-workspace-option"
                    data-active={space.id === state.activeSpaceId ? "true" : "false"}
                    onClick={() => {
                      void invoke(ARC_IPC.activateSpace, space.id);
                      setWorkspaceOpen(false);
                    }}
                  >
                    <span className="zen-workspace-option-icon" style={{ color: space.color }}>{space.icon}</span>
                    <span>{space.name}</span>
                    {space.id === state.activeSpaceId ? <Check size={14} className="ml-auto" /> : null}
                  </button>
                ))}
                <span className="zen-menu-separator" />
                <button
                  type="button"
                  className="zen-workspace-option"
                  onClick={() => {
                    void invoke(ARC_IPC.createSpace, { name: `Workspace ${state.spaces.length + 1}` });
                    setWorkspaceOpen(false);
                  }}
                >
                  <Plus size={14} />
                  <span>New workspace</span>
                </button>
              </div>
            ) : null}
          </div>

          <div className="zen-foot">
            <button
              type="button"
              aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
              className="zen-foot-btn"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <PanelLeft size={16} /> : <PanelRight size={16} />}
            </button>
            <div className="zen-workspace-strip" aria-label="Workspaces">
              {state.spaces.map((space) => (
                <button
                  key={space.id}
                  type="button"
                  className="zen-ws"
                  data-active={space.id === state.activeSpaceId ? "true" : "false"}
                  title={space.name}
                  aria-label={space.name}
                  style={{ color: space.color }}
                  onClick={() => void invoke(ARC_IPC.activateSpace, space.id)}
                >
                  {space.icon || space.name.slice(0, 1).toUpperCase()}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Create new tab"
              className="zen-foot-btn"
              onClick={() => void invoke(ARC_IPC.newTab, {})}
            >
              <Plus size={16} />
            </button>
            <button type="button" aria-label="Command bar" className="zen-foot-command" onClick={onCommand}>
              <span>⌘T</span>
            </button>
          </div>
        </div>

        <div
          className="zen-sidebar-splitter"
          role="separator"
          aria-label="Resize sidebar"
          onPointerDown={(event) => {
            event.preventDefault();
            const onMove = (move: PointerEvent) => {
              const next = side === "left" ? move.clientX : window.innerWidth - move.clientX;
              setWidth(Math.min(420, Math.max(180, Math.round(next))));
            };
            const onUp = () => {
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
          }}
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        />

        {sidebarMenuOpen ? (
          <div ref={sidebarMenuRef} className="zen-top-menu" role="menu">
            <button type="button" className="zen-menu-item" onClick={() => setCompactMode((value) => !value)}>
              {compactMode ? <PanelLeft size={14} /> : <PanelRight size={14} />}
              <span>{compactMode ? "Disable compact mode" : "Enable compact mode"}</span>
              <span className="zen-menu-shortcut">⌘⇧L</span>
            </button>
            <button type="button" className="zen-menu-item" onClick={() => setExpanded((value) => !value)}>
              <PanelLeft size={14} />
              <span>{expanded ? "Collapse sidebar" : "Expand sidebar"}</span>
            </button>
            <button
              type="button"
              className="zen-menu-item"
              onClick={() => {
                setSide((value) => (value === "left" ? "right" : "left"));
                setSidebarMenuOpen(false);
              }}
            >
              {side === "left" ? <PanelRight size={14} /> : <PanelLeft size={14} />}
              <span>Move sidebar {side === "left" ? "right" : "left"}</span>
            </button>
            <button type="button" className="zen-menu-item" onClick={() => setWidth(DEFAULT_WIDTH)}>
              <RotateCcw size={14} />
              <span>Reset sidebar width</span>
              <span className="zen-menu-shortcut">230px</span>
            </button>
            <button type="button" className="zen-menu-item" onClick={() => setNewTabAtTop((value) => !value)}>
              <Plus size={14} />
              <span>Place new-tab button at {newTabAtTop ? "bottom" : "top"}</span>
            </button>
            <span className="zen-menu-separator" />
            <button type="button" className="zen-menu-item" onClick={() => { onCommand(); setSidebarMenuOpen(false); }}>
              <Search size={14} />
              <span>Search tabs</span>
              <span className="zen-menu-shortcut">⌘T</span>
            </button>
          </div>
        ) : null}

        {contextMenu && selectedTab ? (
          <div
            ref={menuRef}
            className="zen-context-menu"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="zen-context-heading">
              <Favicon url={selectedTab.url} iconUrl={selectedTab.iconUrl} size={16} />
              <span>{selectedTab.title || selectedTab.url}</span>
            </div>
            {editor ? (
              <form className="zen-menu-editor" onSubmit={saveEditor}>
                <label htmlFor="zen-sidebar-editor">{editor.kind === "url" ? "Pinned URL" : "Tab icon URL"}</label>
                <input
                  id="zen-sidebar-editor"
                  autoFocus
                  value={editor.value}
                  onChange={(event) => setEditor((current) => (current ? { ...current, value: event.target.value } : current))}
                  placeholder={editor.kind === "url" ? "https://example.com" : "https://example.com/icon.png"}
                />
                <div className="zen-menu-editor-actions">
                  <button type="button" className="zen-menu-secondary" onClick={() => setEditor(null)}>Cancel</button>
                  <button type="submit" className="zen-menu-primary"><Check size={13} /> Save</button>
                </div>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="zen-menu-item"
                  disabled={!selectedTab.pinnedChanged}
                  onClick={() => {
                    updateTab(selectedTab.id, { iconUrl: null, pinnedChanged: false });
                    setContextMenu(null);
                  }}
                >
                  <RotateCcw size={14} />
                  <span>Reset pinned icon</span>
                </button>
                <button type="button" className="zen-menu-item" onClick={() => openEditor(selectedTab, "url")}>
                  <ExternalLink size={14} />
                  <span>Edit / replace pinned URL</span>
                </button>
                <button
                  type="button"
                  className="zen-menu-item"
                  disabled={selectedTab.kind !== "pinned" && essentials.length >= MAX_ESSENTIALS}
                  onClick={() => toggleEssential(selectedTab)}
                >
                  <Pin size={14} />
                  <span>{selectedTab.kind === "pinned" && !selectedTab.folderId ? "Remove essential" : "Add essential"}</span>
                  <span className="zen-menu-badge">{essentials.length}/{MAX_ESSENTIALS}</span>
                </button>
                <button type="button" className="zen-menu-item" onClick={() => startRename(selectedTab)}>
                  <Pencil size={14} />
                  <span>Edit tab title</span>
                </button>
                <button type="button" className="zen-menu-item" onClick={() => openEditor(selectedTab, "icon")}>
                  <Globe2 size={14} />
                  <span>Edit tab icon</span>
                </button>
                <span className="zen-menu-separator" />
                <button type="button" className="zen-menu-item" onClick={() => { updateTab(selectedTab.id, { muted: !selectedTab.muted }); setContextMenu(null); }}>
                  {selectedTab.muted ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  <span>{selectedTab.muted ? "Unmute tab" : "Mute tab"}</span>
                </button>
                <button type="button" className="zen-menu-item" onClick={() => { updateTab(selectedTab.id, { glance: !selectedTab.glance }); setContextMenu(null); }}>
                  <MoreHorizontal size={14} />
                  <span>{selectedTab.glance ? "Close glance tab" : "Open as glance"}</span>
                </button>
                <button type="button" className="zen-menu-item" onClick={() => { updateTab(selectedTab.id, { audio: !selectedTab.audio }); setContextMenu(null); }}>
                  <Volume2 size={14} />
                  <span>{selectedTab.audio ? "Clear audio state" : "Mark as playing audio"}</span>
                </button>
                <button type="button" className="zen-menu-item" onClick={() => { updateTab(selectedTab.id, { blocked: !selectedTab.blocked }); setContextMenu(null); }}>
                  <X size={14} />
                  <span>{selectedTab.blocked ? "Clear blocked state" : "Mark as blocked"}</span>
                </button>
                <button type="button" className="zen-menu-item" onClick={() => { updateTab(selectedTab.id, { sublabel: selectedTab.sublabel ? null : "Pinned hint" }); setContextMenu(null); }}>
                  <Pencil size={14} />
                  <span>{selectedTab.sublabel ? "Hide sublabel" : "Show sublabel"}</span>
                </button>
                <button
                  type="button"
                  className="zen-menu-item"
                  onClick={() => {
                    void invoke(ARC_IPC.createFolder, { spaceId: selectedTab.spaceId, name: "New folder" }).then((created) => {
                      const folder = created as { id?: string } | null;
                      if (folder?.id) void invoke(ARC_IPC.moveToFolder, { id: selectedTab.id, folderId: folder.id });
                    });
                    setContextMenu(null);
                  }}
                >
                  <FolderPlus size={14} />
                  <span>Move to new folder</span>
                </button>
                {selectedTab.kind !== "pinned" ? (
                  <button
                    type="button"
                    className="zen-menu-item zen-menu-item-danger"
                    onClick={() => {
                      void invoke(ARC_IPC.closeTab, selectedTab.id);
                      setContextMenu(null);
                    }}
                  >
                    <X size={14} />
                    <span>Close tab</span>
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </aside>
    </>
  );
}
