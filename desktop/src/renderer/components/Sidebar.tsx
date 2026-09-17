// biome-ignore-all lint/performance/noJsxPropsBind: These small native controls use current render state; callback identity is not a memoization boundary.
import {
  CHROME_IPC,
  type BrowserExtension,
  type BrowserSurfaceProps,
  sidebarRevealed,
} from "@shared/browser-ui";
import { ARC_IPC } from "@shared/ipc";
import { ChevronDown, Folder as FolderIcon, Pin, Puzzle } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useSidebarInteraction } from "@/hooks/useSidebarInteraction";
import {
  SidebarFootActions,
  SidebarNewTab,
  SidebarResize,
  SidebarToolbar,
} from "./browser/SidebarChrome";
import {
  isEssentialTab,
  MAX_ESSENTIALS,
  useSidebarDrag,
} from "./browser/SidebarDrag";
import { SidebarTab } from "./browser/SidebarTab";
import {
  SidebarWorkspaceSwitcher,
} from "./browser/SidebarWorkspaces";
import { SidebarChatHistory } from "./browser/SidebarChatHistory";
import "@/styles/zen-sidebar.css";

/** The complete sidebar WebContentsView, including its transparent gutter. */
export function Sidebar({ state, ui, invoke }: BrowserSurfaceProps) {
  const p = ui.preferences;
  const expanded = sidebarRevealed(ui);
  const compactHidden = p.sidebarMode !== "expanded" && !expanded;
  const interaction = useSidebarInteraction(invoke, ui.sidebar);
  const drag = useSidebarDrag(state, invoke, interaction.setDragging);
  const [extensions, setExtensions] = useState<BrowserExtension[]>([]);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const newTabRef = useRef<HTMLDivElement>(null);
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  const tabs = state.tabs.filter((tab) => tab.spaceId === state.activeSpaceId);
  const folders = state.folders.filter(
    (folder) => folder.spaceId === state.activeSpaceId
  );
  const folderIds = new Set(folders.map((folder) => folder.id));
  const rootTabs = tabs.filter(
    (tab) => !(tab.folderId && folderIds.has(tab.folderId))
  );
  // Eight sidebar slots, not an eight-pin storage limit. Remaining pins live
  // in the optional top strip; both surfaces preserve the same tab ordering.
  const essentials = rootTabs
    .filter((tab) => tab.kind === "pinned")
    .slice(0, MAX_ESSENTIALS);
  const normalTabs = rootTabs.filter((tab) => tab.kind === "today");
  const essentialCount = tabs.filter(isEssentialTab).length;
  const destination = { folderId: null, spaceId: state.activeSpaceId };
  const pinnedExtensions = extensions
    .filter((extension) => extension.enabled && extension.pinned)
    .slice(0, 4);

  useEffect(() => {
    let mounted = true;
    const refreshExtensions = async () => {
      try {
        const result = await invoke<BrowserExtension[]>(CHROME_IPC.extensions);
        if (mounted && Array.isArray(result)) setExtensions(result);
      } catch {
        if (mounted) setExtensions([]);
      }
    };
    void refreshExtensions();
    const offRegistry = window.zenmium?.on(
      CHROME_IPC.extensionRegistryChanged,
      () => void refreshExtensions(),
    );
    const offChrome = window.zenmium?.on(
      CHROME_IPC.event,
      () => void refreshExtensions(),
    );
    return () => {
      mounted = false;
      offRegistry?.();
      offChrome?.();
    };
  }, [invoke]);

  useEffect(() => {
    const viewport = scrollRef.current;
    const content = listRef.current;
    if (!(viewport && content)) {
      return;
    }
    // Include a prospective 40px new-tab slot even while it is hidden, avoiding
    // an overflow -> hide -> no overflow -> show ResizeObserver cycle.
    const measure = () => {
      const slotHeight = newTabRef.current?.getBoundingClientRect().height ?? 0;
      setTabsOverflow(
        content.scrollHeight - slotHeight + 40 > viewport.clientHeight
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: This is the native hover boundary; actions are accessible child buttons.
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: The full transparent viewport must track native mouse enter/leave and drag.
    <div
      className="zen-sidebar-surface"
      data-dark={ui.dark}
      data-dragging={!!drag.draggingId}
      data-expanded={expanded}
      data-hidden={compactHidden}
      data-mode={p.sidebarMode}
      data-side={p.side}
      onBlurCapture={interaction.onBlurCapture}
      onDragEnter={interaction.enter}
      onDragLeave={(event) => {
        if (
          !(
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
        ) {
          interaction.leave();
        }
      }}
      onFocusCapture={interaction.onFocusCapture}
      onMouseEnter={interaction.enter}
      onMouseLeave={interaction.leave}
      ref={interaction.surfaceRef}
      style={
        {
          "--zen-primary-color": "var(--zen-workspace-color)",
          "--zen-sidebar-width": `${p.width}px`,
        } as CSSProperties
      }
    >
      <aside
        aria-label="Browser sidebar"
        className="zen-sidebar"
        inert={compactHidden}
        zen-compact-mode={p.sidebarMode === "compact" ? "true" : undefined}
        zen-has-hover={ui.sidebar.hovered ? "true" : undefined}
        zen-sidebar-expanded={expanded ? "true" : undefined}
      >
        <SidebarToolbar active={active} invoke={invoke} ui={ui} />
        <div
          className="zen-sidebar-scroll"
          data-overflow={tabsOverflow}
          ref={scrollRef}
        >
          <div className="zen-sidebar-list" ref={listRef}>
            {pinnedExtensions.length ? (
              <div
                aria-label="Pinned extensions"
                className="zen-extension-pin-pill"
                data-count={pinnedExtensions.length}
                role="toolbar"
              >
                {pinnedExtensions.map((extension) => (
                  <button
                    aria-label={`Run ${extension.name}`}
                    className="zen-extension-pin"
                    key={extension.id}
                    onClick={() =>
                      void (async () => {
                        try {
                          const result = await invoke(CHROME_IPC.extensionTrigger, { id: extension.id });
                          if (result && typeof result === "object" && (result as { ok?: boolean }).ok) return;
                        } catch {
                          // Fall through to the Extensions panel.
                        }
                        await invoke(CHROME_IPC.open, { kind: "extensions" });
                      })()
                    }
                    title={`${extension.name} · Click to run, panel on fallback`}
                    type="button"
                  >
                    <Puzzle aria-hidden="true" size={13} />
                    <span>{extension.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <section
              aria-label="Essential tabs"
              className="zen-essentials"
              data-count={essentials.length}
              {...drag.zone("essentials", {
                ...destination,
                beforeId: null,
                kind: "pinned",
              })}
            >
              {essentials.map((tab) => (
                <SidebarTab
                  active={tab.id === state.activeTabId}
                  drag={drag}
                  essential
                  invoke={invoke}
                  key={tab.id}
                  siblings={essentials}
                  tab={tab}
                />
              ))}
              {essentials.length === 0 ? (
                <div
                  className="zen-essentials-promo"
                  title={`Drop tabs here to pin (${essentialCount} saved, ${MAX_ESSENTIALS} sidebar slots)`}
                >
                  <Pin aria-hidden="true" size={14} />
                  <span>Drop tabs here to pin</span>
                </div>
              ) : null}
            </section>
            <section
              aria-label="Pinned tabs"
              className="zen-pinned-section"
              id="zen-sidebar-pinned"
              {...drag.zone("pinned", {
                ...destination,
                beforeId: null,
                kind: "pinned",
              })}
            >
              {folders.map((folder) => {
                const children = tabs.filter(
                  (tab) => tab.folderId === folder.id
                );
                return (
                  <div
                    className="zen-folder"
                    data-collapsed={folder.collapsed}
                    data-open={!folder.collapsed}
                    key={folder.id}
                    {...drag.zone(`folder:${folder.id}`, {
                      beforeId: null,
                      folderId: folder.id,
                      kind: "pinned",
                      spaceId: folder.spaceId,
                    })}
                  >
                    <button
                      aria-controls={`zen-folder-${folder.id}`}
                      aria-expanded={!folder.collapsed}
                      aria-label={folder.name}
                      className="zen-folder-heading t-acc-head"
                      onClick={() =>
                        invoke("arc:updateFolder", {
                          id: folder.id,
                          patch: { collapsed: !folder.collapsed },
                        })
                      }
                      title={folder.name}
                      type="button"
                    >
                      <FolderIcon aria-hidden="true" size={16} />
                      <span>{folder.name}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className="zen-chevron-closed t-acc-chevron"
                        size={12}
                      />
                    </button>
                    <div
                      className="zen-folder-tabs t-acc-panel"
                      inert={folder.collapsed ? true : undefined}
                    >
                      <div className="t-acc-panel-inner" id={`zen-folder-${folder.id}`}>
                        {children.map((tab) => (
                          <SidebarTab
                            active={tab.id === state.activeTabId}
                            drag={drag}
                            invoke={invoke}
                            key={tab.id}
                            nested
                            siblings={children}
                            tab={tab}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
            <section
              aria-label="Tabs"
              className="zen-normal-tabs"
              data-new-tab-top={p.newTabAtTop}
              {...drag.zone("normal", {
                ...destination,
                beforeId: null,
                kind: "today",
              })}
            >
              <div className="zen-tab-rows">
                {normalTabs.map((tab) => (
                  <SidebarTab
                    active={tab.id === state.activeTabId}
                    drag={drag}
                    invoke={invoke}
                    key={tab.id}
                    siblings={normalTabs}
                    tab={tab}
                  />
                ))}
              </div>
              <div
                className="zen-new-tab-slot"
                hidden={tabsOverflow}
                ref={newTabRef}
              >
                <SidebarNewTab
                  invoke={invoke}
                  open={ui.overlay?.kind === "new-tab"}
                  spaceId={state.activeSpaceId}
                />
              </div>
              {drag.draggingId ? (
                <div aria-hidden="true" className="zen-unpin-hint">
                  Drop to keep as a regular tab
                </div>
              ) : null}
            </section>
          </div>
        </div>
        {drag.error ? (
          <p className="zen-sidebar-error" role="status">
            {drag.error}
          </p>
        ) : null}
        {drag.pendingMove ? (
          <section aria-label="Move tab to another profile" className="zen-sidebar-move-confirm" role="alert">
            <strong>Move and reload this tab?</strong>
            <p>{drag.pendingMove.reason}</p>
            <p>Unsaved input may be lost. This Workspace uses its own accounts and cookies.</p>
            <div>
              <button disabled={drag.moving} onClick={() => void drag.confirmMove()} type="button">Move and reload</button>
              <button disabled={drag.moving} onClick={drag.cancelMove} type="button">Cancel</button>
            </div>
          </section>
        ) : null}
        <footer className="zen-sidebar-footer">
          <SidebarChatHistory
            activeSpaceId={state.activeSpaceId}
            entries={ui.chatHistory}
            invoke={invoke}
            overlayChatId={ui.overlay?.chatId}
            spaces={state.spaces}
          />
          <SidebarWorkspaceSwitcher
            activeSpaceId={state.activeSpaceId}
            drag={drag}
            invoke={invoke}
            open={
              ui.overlay?.kind === "workspace" ||
              ui.overlay?.kind === "workspace-edit"
            }
            spaces={state.spaces}
          />
        <SidebarFootActions
          agentOpen={ui.overlay?.kind === "agent"}
          agentSessionId={ui.overlay?.sessionId}
          invoke={invoke}
        />
        </footer>
      </aside>
      {expanded ? (
        <SidebarResize
          invoke={invoke}
          preferences={p}
          setDragging={interaction.setDragging}
        />
      ) : null}
    </div>
  );
}
