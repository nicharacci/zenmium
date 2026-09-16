// biome-ignore-all lint/performance/noJsxPropsBind: These small native controls use current render state; callback identity is not a memoization boundary.
import { CHROME_IPC, type Invoke } from "@shared/browser-ui";
import { ARC_IPC, type Tab } from "@shared/ipc";
import { openTabContextMenuFromKeyboard } from "@shared/tab-context-menu";
import { Globe2, LoaderCircle, Volume2, VolumeX, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { getFaviconUrl } from "@/lib/favicon";
import type { SidebarDrag } from "./SidebarDrag";

export type SidebarTabModel = Tab;
export const sidebarTabTitle = (tab: SidebarTabModel) =>
  tab.customTitle || tab.title || tab.url || "New Tab";

function isPinnedChanged(tab: Tab) {
  return (
    tab.kind === "pinned" &&
    (tab.pinnedChanged || (!!tab.pinnedUrl && tab.pinnedUrl !== tab.url))
  );
}

export function SidebarFavicon({
  url,
  iconUrl,
}: {
  url: string;
  iconUrl?: string;
}) {
  const src = iconUrl || getFaviconUrl(url);
  const [failed, setFailed] = useState<string | null>(null);
  return src && failed !== src ? (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError swaps a failed favicon; it is not a user interaction.
    <img
      alt=""
      className="zen-tab-icon"
      draggable={false}
      height={16}
      onError={() => setFailed(src)}
      src={src}
      width={16}
    />
  ) : (
    <Globe2 aria-hidden="true" className="zen-tab-icon zen-tab-icon-fallback" />
  );
}

function TabRename({
  tab,
  invoke,
  onDone,
}: {
  tab: SidebarTabModel;
  invoke: Invoke;
  onDone: () => void;
}) {
  const [value, setValue] = useState(sidebarTabTitle(tab));
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (finished.current) {
      return;
    }
    finished.current = true;
    const customTitle = value.trim();
    if (save && customTitle !== (tab.customTitle ?? "")) {
      invoke(ARC_IPC.updateTab, {
        id: tab.id,
        patch: { customTitle: customTitle || null },
      });
    }
    onDone();
  };
  return (
    <input
      aria-label="Rename tab"
      className="zen-tab-rename"
      onBlur={() => finish(true)}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) {
          return;
        }
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          finish(event.key === "Enter");
        }
      }}
      ref={inputRef}
      value={value}
    />
  );
}

export function SidebarTab({
  tab,
  active,
  essential = false,
  nested = false,
  drag,
  siblings,
  invoke,
}: {
  tab: SidebarTabModel;
  active: boolean;
  essential?: boolean;
  nested?: boolean;
  drag: SidebarDrag;
  siblings: Tab[];
  invoke: Invoke;
}) {
  const [renaming, setRenaming] = useState(false);
  const title = sidebarTabTitle(tab);
  const pinnedChanged = isPinnedChanged(tab);
  const iconUrl = tab.iconUrl || tab.faviconUrl;
  const style = {
    "--zen-container-color": tab.containerColor || "transparent",
  } as CSSProperties;

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Tab group delegates keyboard actions to child buttons; mouse-only auxiliary close and drag also apply to its padding.
    // biome-ignore lint/a11y/useSemanticElements: This is a group of tab controls, not a form fieldset.
    <div
      aria-label={title}
      className={essential ? "zen-tab zen-essential" : "zen-tab"}
      data-active={active}
      data-discarded={tab.discarded}
      data-glance={tab.glance}
      data-has-audio={!!(tab.audio || tab.muted)}
      data-nested={nested}
      data-pending={tab.loading}
      data-pinned-changed={pinnedChanged}
      data-renaming={renaming}
      draggable={!renaming}
      role="group"
      style={style}
      {...drag.row(tab, siblings, essential)}
      onAuxClick={(event) => {
        if (event.button !== 1) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        invoke(ARC_IPC.closeTab, tab.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // Overlay owns the horizontal anchor in window coordinates (also on right).
        invoke(CHROME_IPC.open, {
          kind: "tab-menu",
          tabId: tab.id,
          y: event.clientY,
        });
      }}
      onMouseDown={(event) => {
        if (event.button === 1) {
          event.preventDefault();
        }
      }}
    >
      {essential && iconUrl ? (
        <span aria-hidden="true" className="zen-essential-backdrop">
          <img alt="" draggable={false} height={92} src={iconUrl} width={92} />
        </span>
      ) : null}
      {tab.containerColor ? (
        <span aria-hidden="true" className="zen-container-line" />
      ) : null}
      {renaming ? (
        <TabRename
          invoke={invoke}
          onDone={() => setRenaming(false)}
          tab={tab}
        />
      ) : (
        <button
          aria-current={active ? "page" : undefined}
          aria-label={title}
          className="zen-tab-main"
          draggable
          onClick={() => invoke(ARC_IPC.activateTab, tab.id)}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setRenaming(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }
            if (event.key === "F2") {
              event.preventDefault();
              setRenaming(true);
              return;
            }
            openTabContextMenuFromKeyboard(
              event,
              event.currentTarget,
              tab.id,
              (payload) => invoke(CHROME_IPC.open, payload),
            );
          }}
          title={`${title}${tab.url ? `\n${tab.url}` : ""}`}
          type="button"
        >
          <span className="zen-tab-icon-stack">
            {tab.loading ? (
              <LoaderCircle
                aria-label="Loading"
                className="zen-tab-icon zen-tab-loading"
              />
            ) : (
              <SidebarFavicon iconUrl={iconUrl} url={tab.url} />
            )}
            {tab.blocked ? (
              <span
                aria-label="Audio blocked"
                className="zen-tab-blocked"
                role="img"
              >
                !
              </span>
            ) : null}
          </span>
          <span className="zen-tab-copy">
            <span className="zen-tab-label">{title}</span>
            {tab.sublabel ? (
              <span className="zen-tab-sublabel">{tab.sublabel}</span>
            ) : null}
          </span>
        </button>
      )}
      {renaming ? null : (
        <SidebarTabActions
          invoke={invoke}
          pinnedChanged={!!pinnedChanged}
          tab={tab}
          title={title}
        />
      )}
    </div>
  );
}

function SidebarTabActions({
  tab,
  title,
  invoke,
  pinnedChanged,
}: {
  tab: Tab;
  title: string;
  invoke: Invoke;
  pinnedChanged: boolean;
}) {
  const audio = tab.audio || tab.muted;
  return (
    <>
      {audio ? (
        <button
          aria-label={tab.muted ? `Unmute ${title}` : `Mute ${title}`}
          className="zen-tab-audio"
          onClick={(event) => {
            event.stopPropagation();
            invoke(ARC_IPC.updateTab, {
              id: tab.id,
              patch: { muted: !tab.muted },
            });
          }}
          title={tab.muted ? "Unmute tab" : "Mute tab"}
          type="button"
        >
          {tab.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
      ) : null}
      {pinnedChanged ? (
        <button
          aria-label={`Reset ${title} to pinned URL`}
          className="zen-tab-reset"
          onClick={(event) => {
            event.stopPropagation();
            invoke("arc:resetTab", tab.id);
          }}
          title="Reset to pinned URL"
          type="button"
        >
          <SidebarFavicon
            iconUrl={tab.originalIconUrl}
            url={tab.pinnedUrl || tab.url}
          />
        </button>
      ) : null}
      {tab.kind !== "pinned" && !tab.glance ? (
        <button
          aria-label={`Close ${title}`}
          className="zen-tab-close"
          onClick={(event) => {
            event.stopPropagation();
            invoke(ARC_IPC.closeTab, tab.id);
          }}
          title="Close tab"
          type="button"
        >
          <X size={12} />
        </button>
      ) : null}
    </>
  );
}
