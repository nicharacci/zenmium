import {
  type BrowserExtension,
  type BrowserPreferences,
  CHROME_IPC,
  type DownloadRecord,
  type PanelKind,
  STORE_INSTALL_IPC,
} from "@shared/browser-ui";
import {
  ARC_IPC,
  SPACE_COLORS,
  type Space,
  type TabUpdate,
} from "@shared/ipc";
import { resolveAddress } from "@shared/navigation";
import {
  Archive,
  Bookmark,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Columns2,
  Download,
  File,
  Folder,
  FolderOpen,
  History,
  Info,
  LockKeyhole,
  MessageCircle,
  Palette,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Puzzle,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  SquareArrowOutUpRight,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BeuiChatDrawer } from "./BeuiChatDrawer";
import { GoalpostOnboarding } from "./GoalpostOnboarding";
import { NativePageActions, NativeSettings } from "./BrowserNativePanels";
import { StoreInstall } from "../StoreInstall";
import type { StoreInstallProgress, StoreInstallResult } from "../../../main/store-install";
import { ThemeColorPicker } from "./ThemeColorPicker";
import {
  ActionStatus,
  checkedInvoke,
  displayHost,
  EmptyState,
  errorMessage,
  historyEntries,
  MenuItem,
  PanelHeader,
  RovingMenu,
  SurfaceButton,
  type SurfaceTab,
  tabTitle,
  type UtilityProps,
  useSurfaceAction,
} from "./SurfacePrimitives";

export function BrowserUtilities(props: UtilityProps) {
  switch (props.ui.overlay?.kind) {
    case "menu":
      return <BrowserMenu {...props} />;
    case "tab-menu":
      return <TabMenu {...props} />;
    case "workspace":
    case "workspace-edit":
      return <WorkspacePanel {...props} />;
    case "history":
      return <HistoryPanel {...props} />;
    case "downloads":
      return <DownloadsPanel {...props} />;
    case "extensions":
      return <ExtensionsPanel {...props} />;
    case "settings":
      return <SettingsPanel {...props} />;
    case "agent":
      return <AgentPanel {...props} />;
    case "site-info":
      return <SiteInfoPanel {...props} />;
    case "onboarding":
      return <GoalpostOnboarding {...props} />;
    default:
      return null;
  }
}

function AgentPanel({ state, ui, invoke }: UtilityProps) {
  return <BeuiChatDrawer invoke={invoke} state={state} ui={ui} />;
}

function BrowserMenu({ state, invoke, close }: UtilityProps) {
  const action = useSurfaceAction();
  const [split, setSplit] = useState(false);
  const open = (kind: PanelKind) =>
    void action.run("Opening", () =>
      checkedInvoke(invoke, CHROME_IPC.open, { kind })
    );
  const candidates = state.tabs.filter(
    (tab) => tab.id !== state.activeTabId && tab.spaceId === state.activeSpaceId
  );
  return (
    <>
      <PanelHeader
        close={close}
        subtitle={
          split ? "Choose a tab to show alongside the current page" : undefined
        }
        title={split ? "Split view" : "Zenmium"}
      />
      {split ? (
        <>
          <div className="zen-overlay-pad">
            <SurfaceButton icon={ArrowLeft} onClick={() => setSplit(false)}>
              Back
            </SurfaceButton>
          </div>
          <RovingMenu label="Split with a tab">
            {candidates.map((tab) => (
              <MenuItem
                disabled={Boolean(action.busy)}
                icon={Columns2}
                key={tab.id}
                onClick={() =>
                  void action.run(
                    "Opening split view",
                    () => checkedInvoke(invoke, "arc:toggleSplit", tab.id),
                    close
                  )
                }
              >
                {tabTitle(tab)}
              </MenuItem>
            ))}
          </RovingMenu>
          {!candidates.length && (
            <EmptyState icon={Columns2} title="Open another tab to split">
              Split view displays two tabs in this workspace.
            </EmptyState>
          )}
        </>
      ) : (
        <RovingMenu label="Browser actions">
          <MenuItem
            disabled={Boolean(action.busy)}
            hint="⌘T"
            icon={Plus}
            onClick={() => open("new-tab")}
          >
            New tab
          </MenuItem>
          <MenuItem
            disabled={Boolean(action.busy)}
            hint="⌘K"
            icon={Search}
            onClick={() => open("commands")}
          >
            Commands
          </MenuItem>
          <hr />
          <MenuItem disabled={Boolean(action.busy)} icon={Bookmark} onClick={() => open("bookmarks")}>Bookmarks</MenuItem>
          <MenuItem
            disabled={Boolean(action.busy)}
            icon={History}
            onClick={() => open("history")}
          >
            History & archive
          </MenuItem>
          <MenuItem
            disabled={Boolean(action.busy)}
            icon={Download}
            onClick={() => open("downloads")}
          >
            Downloads
          </MenuItem>
          <MenuItem
            disabled={Boolean(action.busy)}
            icon={Puzzle}
            onClick={() => open("extensions")}
          >
            Extensions
          </MenuItem>
          <MenuItem
            disabled={Boolean(action.busy)}
            icon={Palette}
            onClick={() => open("workspace")}
          >
            Workspaces
          </MenuItem>
          <MenuItem
            disabled={
              Boolean(action.busy) || !state.activeTabId || !candidates.length
            }
            icon={Columns2}
            onClick={() => setSplit(true)}
          >
            Split view…
          </MenuItem>
          {state.splitTabId && (
            <MenuItem
              disabled={Boolean(action.busy)}
              icon={X}
              onClick={() =>
                void action.run(
                  "Closing split view",
                  () =>
                    checkedInvoke(invoke, "arc:toggleSplit", state.splitTabId),
                  close
                )
              }
            >
              Close split view
            </MenuItem>
          )}
          <MenuItem
            disabled={Boolean(action.busy) || !state.archive.length}
            icon={RotateCcw}
            onClick={() =>
              void action.run(
                "Restoring tab",
                () =>
                  checkedInvoke(
                    invoke,
                    ARC_IPC.restoreTab,
                    state.archive[0]!.id
                  ),
                close
              )
            }
          >
            Reopen archived tab
          </MenuItem>
          <hr />
          <MenuItem
            disabled={Boolean(action.busy)}
            icon={MessageCircle}
            onClick={() => open("agent")}
          >
            Agent
          </MenuItem>
          <MenuItem
            disabled={Boolean(action.busy)}
            icon={Settings2}
            onClick={() => open("settings")}
          >
            Settings
          </MenuItem>
        </RovingMenu>
      )}
      <ActionStatus {...action} />
      {!split && <NativePageActions state={state} invoke={invoke} openFind={() => open("find")}/>}
    </>
  );
}

function TabMenu({ state, ui, invoke, close }: UtilityProps) {
  const tab: SurfaceTab | undefined = state.tabs.find(
    (item) => item.id === (ui.overlay?.tabId ?? state.activeTabId)
  );
  const action = useSurfaceAction();
  const [editor, setEditor] = useState<
    "title" | "icon" | "url" | "split" | "folder" | null
  >(null);
  const [value, setValue] = useState("");
  if (!tab)
    return (
      <>
        <PanelHeader close={close} title="Tab" />
        <EmptyState title="This tab is no longer open" />
      </>
    );
  const isEssential = tab.kind === "pinned" && !tab.folderId;
  const call = (
    label: string,
    channel: string,
    payload?: unknown,
    dismiss = true
  ) =>
    void action.run(
      label,
      () => checkedInvoke(invoke, channel, payload),
      dismiss ? close : undefined
    );
  const edit = (kind: "title" | "icon" | "url") => {
    setEditor(kind);
    setValue(
      kind === "title"
        ? (tab.customTitle ?? tab.title)
        : kind === "icon"
          ? (tab.iconUrl ?? "")
          : (tab.pinnedUrl ?? tab.url)
    );
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action.run(
      "Saving tab",
      async () => {
        let patch: TabUpdate;
        if (editor === "title") patch = { customTitle: value.trim() || null };
        else if (editor === "icon") {
          const icon = value.trim();
          if (
            icon.includes(":") &&
            !/^https?:\/\//i.test(icon) &&
            !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(icon)
          )
            throw new Error(
              "Use an emoji, an https image URL, or a PNG, JPEG, WebP, or GIF data URL."
            );
          patch = { iconUrl: icon || null };
        } else {
          const url = resolveAddress(value, ui.preferences.searchEngine);
          if (
            !value.trim() ||
            /^(https:\/\/duckduckgo.com\/\?q=|https:\/\/www.google.com\/search\?q=)/.test(
              url
            )
          )
            throw new Error("Enter a URL for this essential.");
          patch = { pinnedUrl: url, url };
        }
        await checkedInvoke(invoke, ARC_IPC.updateTab, { id: tab.id, patch });
      },
      () => setEditor(null)
    );
  };
  const labels = {
    folder: "Move to folder",
    icon: "Edit tab icon",
    split: "Split with…",
    title: "Edit tab title",
    url: "Edit pinned URL",
  };
  return (
    <>
      <PanelHeader
        close={close}
        subtitle={tabTitle(tab)}
        title={editor ? labels[editor] : "Tab actions"}
      />
      {editor && (
        <div className="zen-overlay-pad">
          <SurfaceButton
            disabled={Boolean(action.busy)}
            icon={ArrowLeft}
            onClick={() => setEditor(null)}
          >
            Back
          </SurfaceButton>
        </div>
      )}
      {editor === "title" || editor === "icon" || editor === "url" ? (
        <form className="zen-overlay-form" onSubmit={save}>
          <label>
            {editor === "title"
              ? "Custom title"
              : editor === "icon"
                ? "Emoji or image URL"
                : "Pinned URL"}
            <input
              data-autofocus
              disabled={Boolean(action.busy)}
              key={editor}
              maxLength={editor === "icon" ? 100000 : 4096}
              onChange={(event) => setValue(event.target.value)}
              value={value}
            />
          </label>
          <p className="zen-overlay-help">
            {editor === "title"
              ? "Leave empty to use the page title."
              : editor === "icon"
                ? "Leave empty to use the site’s favicon."
                : "Saving replaces the essential’s starting URL and navigates to it."}
          </p>
          <SurfaceButton
            disabled={Boolean(action.busy)}
            type="submit"
            variant="primary"
          >
            Save changes
          </SurfaceButton>
        </form>
      ) : editor === "split" ? (
        <RovingMenu label="Tabs to split with">
          {state.tabs
            .filter(
              (item) => item.id !== tab.id && item.spaceId === tab.spaceId
            )
            .map((other) => (
              <MenuItem
                disabled={Boolean(action.busy)}
                icon={Columns2}
                key={other.id}
                onClick={() =>
                  void action.run(
                    "Opening split view",
                    async () => {
                      await checkedInvoke(invoke, ARC_IPC.activateTab, tab.id);
                      await checkedInvoke(invoke, "arc:toggleSplit", other.id);
                    },
                    close
                  )
                }
              >
                {tabTitle(other)}
              </MenuItem>
            ))}
        </RovingMenu>
      ) : editor === "folder" ? (
        <RovingMenu label="Tab folders">
          <MenuItem
            disabled={
              Boolean(action.busy) ||
              !tab.folderId
            }
            icon={FolderOpen}
            onClick={() =>
              call("Moving tab", ARC_IPC.moveToFolder, {
                folderId: null,
                id: tab.id,
              })
            }
          >
            Essentials (no folder)
          </MenuItem>
          {state.folders
            .filter((folder) => folder.spaceId === tab.spaceId)
            .map((folder) => (
              <MenuItem
                disabled={Boolean(action.busy) || tab.folderId === folder.id}
                icon={Folder}
                key={folder.id}
                onClick={() =>
                  call("Moving tab", ARC_IPC.moveToFolder, {
                    folderId: folder.id,
                    id: tab.id,
                  })
                }
              >
                {folder.name}
              </MenuItem>
            ))}
        </RovingMenu>
      ) : (
        <RovingMenu label="Tab actions">
          {tab.kind === "pinned" && (
            <>
              <MenuItem
                disabled={Boolean(action.busy)}
                icon={RotateCcw}
                onClick={() =>
                  call("Resetting pinned tab", "arc:resetTab", tab.id)
                }
              >
                Reset to pinned URL
              </MenuItem>
              <MenuItem
                disabled={Boolean(action.busy)}
                icon={Pencil}
                onClick={() => edit("url")}
              >
                Edit pinned URL…
              </MenuItem>
            </>
          )}
          <MenuItem
            disabled={Boolean(action.busy)}
            icon={isEssential ? PinOff : Pin}
            onClick={() =>
              call(
                "Updating essential",
                isEssential ? ARC_IPC.unpinTab : ARC_IPC.pinTab,
                tab.id
              )
            }
          >
            {isEssential ? "Remove essential" : "Add essential"}
          </MenuItem>
          <MenuItem
            disabled={Boolean(action.busy)}
            icon={Pencil}
            onClick={() => edit("title")}
          >
            Edit tab title…
          </MenuItem>
          <MenuItem
            disabled={Boolean(action.busy)}
            icon={Palette}
            onClick={() => edit("icon")}
          >
            Edit tab icon…
          </MenuItem>
          <hr />
          <MenuItem
            disabled={Boolean(action.busy)}
            icon={tab.muted ? Volume2 : VolumeX}
            onClick={() =>
              call("Updating sound", ARC_IPC.updateTab, {
                id: tab.id,
                patch: { muted: !tab.muted },
              })
            }
          >
            {tab.muted ? "Unmute tab" : "Mute tab"}
          </MenuItem>
          <MenuItem
            disabled={
              Boolean(action.busy) ||
              !state.tabs.some(
                (item) => item.id !== tab.id && item.spaceId === tab.spaceId
              )
            }
            icon={Columns2}
            onClick={() => setEditor("split")}
          >
            Split with…
          </MenuItem>
          {state.splitTabId &&
            (state.splitTabId === tab.id || state.activeTabId === tab.id) && (
              <MenuItem
                disabled={Boolean(action.busy)}
                icon={X}
                onClick={() =>
                  call(
                    "Closing split view",
                    "arc:toggleSplit",
                    state.splitTabId
                  )
                }
              >
                Close split view
              </MenuItem>
            )}
          <MenuItem
            disabled={Boolean(action.busy) || !/^https?:/i.test(tab.url)}
            icon={SquareArrowOutUpRight}
            onClick={() => call("Opening Glance", "arc:openPeek", tab.url)}
          >
            Open in Glance
          </MenuItem>
          <MenuItem
            disabled={
              Boolean(action.busy) ||
              !state.folders.some((folder) => folder.spaceId === tab.spaceId)
            }
            icon={Folder}
            onClick={() => setEditor("folder")}
          >
            Move to folder…
          </MenuItem>
          <hr />
          {!isEssential && (
            <>
              <MenuItem
                disabled={Boolean(action.busy)}
                icon={Archive}
                onClick={() =>
                  call("Archiving tab", ARC_IPC.archiveTab, tab.id)
                }
              >
                Archive tab
              </MenuItem>
              <MenuItem
                disabled={Boolean(action.busy)}
                icon={X}
                onClick={() => call("Closing tab", ARC_IPC.closeTab, tab.id)}
              >
                Close tab
              </MenuItem>
            </>
          )}
          <MenuItem
            disabled={Boolean(action.busy) || !state.archive.length}
            icon={RotateCcw}
            onClick={() =>
              call("Restoring tab", ARC_IPC.restoreTab, state.archive[0]!.id)
            }
          >
            Reopen archived tab
          </MenuItem>
        </RovingMenu>
      )}
      <ActionStatus {...action} />
    </>
  );
}

function WorkspacePanel(props: UtilityProps) {
  const { state, ui, invoke, close } = props;
  const [editing, setEditing] = useState<string | "new" | null>(
    ui.overlay?.kind === "workspace-edit" ? (ui.overlay.spaceId ?? "new") : null
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInput = useRef<HTMLInputElement>(null);
  const activateTimer = useRef<number | undefined>(undefined);
  const action = useSurfaceAction();
  const space = state.spaces.find((item) => item.id === editing);
  useEffect(
    () => () => window.clearTimeout(activateTimer.current),
    []
  );
  useEffect(() => {
    if (!renaming) return;
    const frame = requestAnimationFrame(() => {
      renameInput.current?.focus();
      renameInput.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [renaming]);
  const beginRename = (item: Space) => {
    window.clearTimeout(activateTimer.current);
    setRenameValue(item.name);
    setRenaming(item.id);
  };
  const commitRename = (item: Space) => {
    if (renaming !== item.id) return;
    const name = renameValue.trim();
    if (!name) {
      setRenaming(null);
      return;
    }
    setRenaming(null);
    void action.run(
      "Renaming workspace",
      () =>
        checkedInvoke(invoke, ARC_IPC.updateSpace, {
          id: item.id,
          patch: { name },
        }),
      () => {
        setRenameValue("");
      }
    );
  };
  const activate = (item: Space) => {
    window.clearTimeout(activateTimer.current);
    activateTimer.current = window.setTimeout(() => {
      activateTimer.current = undefined;
      void action.run(
        "Switching workspace",
        () => checkedInvoke(invoke, ARC_IPC.activateSpace, item.id),
        close
      );
    }, 220);
  };
  return (
    <>
      <PanelHeader
        close={close}
        subtitle={editing ? undefined : "A little space for everything you do"}
        title={
          editing ? (space ? "Edit workspace" : "New workspace") : "Workspaces"
        }
      />
      {editing ? (
        <>
          <div className="zen-overlay-pad">
            <SurfaceButton icon={ArrowLeft} onClick={() => setEditing(null)}>
              All workspaces
            </SurfaceButton>
          </div>
          {editing !== "new" && !space ? (
            <EmptyState title="This workspace no longer exists" />
          ) : (
            <WorkspaceForm
              key={editing}
              {...props}
              done={() => setEditing(null)}
              space={space}
            />
          )}
        </>
      ) : (
        <>
          <div className="zen-overlay-list">
            {state.spaces.map((item) => (
              <div
                className="zen-overlay-list-row zen-overlay-workspace-row"
                key={item.id}
                style={{ "--zen-space-color": item.color } as CSSProperties}
              >
                {renaming === item.id ? (
                  <form
                    className="zen-overlay-workspace-rename"
                    data-escape-boundary="true"
                    onSubmit={(event) => {
                      event.preventDefault();
                      commitRename(item);
                    }}
                  >
                    <input
                      aria-label={`Rename ${item.name}`}
                      maxLength={80}
                      onBlur={() => commitRename(item)}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      ref={renameInput}
                      value={renameValue}
                    />
                    <SurfaceButton
                      aria-label={`Save ${item.name}`}
                      className="zen-overlay-icon-button"
                      icon={Check}
                      type="submit"
                    />
                  </form>
                ) : (
                  <button
                    aria-current={
                      item.id === state.activeSpaceId ? "true" : undefined
                    }
                    className="zen-overlay-row-main"
                    disabled={Boolean(action.busy)}
                    onClick={() => activate(item)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      beginRename(item);
                    }}
                    title="Double-click to rename"
                    type="button"
                  >
                    <span className="zen-overlay-text">
                      <strong>{item.name}</strong>
                      <small>
                        {
                          state.tabs.filter((tab) => tab.spaceId === item.id)
                            .length
                        }{" "}
                        tabs
                      </small>
                    </span>
                    {item.id === state.activeSpaceId && (
                      <Check aria-label="Current workspace" size={16} />
                    )}
                  </button>
                )}
                {renaming !== item.id ? (
                  <SurfaceButton
                    aria-label={`Edit ${item.name}`}
                    className="zen-overlay-icon-button"
                    disabled={Boolean(action.busy)}
                    icon={Pencil}
                    onClick={() => setEditing(item.id)}
                  />
                ) : null}
              </div>
            ))}
          </div>
          <div className="zen-overlay-pad">
            <SurfaceButton
              disabled={Boolean(action.busy)}
              icon={Plus}
              onClick={() => setEditing("new")}
            >
              New workspace
            </SurfaceButton>
          </div>
          <ActionStatus {...action} />
        </>
      )}
    </>
  );
}

function WorkspaceForm({
  state,
  invoke,
  space,
  done,
}: UtilityProps & { space?: Space; done: () => void }) {
  const [name, setName] = useState(
    space?.name ?? `Workspace ${state.spaces.length + 1}`
  );
  const [color, setColor] = useState(space?.color ?? SPACE_COLORS[0]);
  const [confirm, setConfirm] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.getPropertyValue("--zen-workspace-preview");
    root.style.setProperty("--zen-workspace-preview", color);
    return () => {
      if (previous) root.style.setProperty("--zen-workspace-preview", previous);
      else root.style.removeProperty("--zen-workspace-preview");
    };
  }, [color]);
  const action = useSurfaceAction();
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action.run(
      "Saving workspace",
      async () => {
        if (!name.trim()) throw new Error("Give this workspace a name.");
        let id = space?.id ?? created;
        if (!id) {
          const result = await checkedInvoke<Space>(
            invoke,
            ARC_IPC.createSpace,
            { color, name: name.trim() }
          );
          if (!result?.id)
            throw new Error(
              "The workspace was created without an ID. Refresh the workspace list before trying again."
            );
          id = result.id;
          setCreated(id);
        }
        await checkedInvoke(invoke, ARC_IPC.updateSpace, {
          id,
          patch: { color, name: name.trim() },
        });
      },
      done
    );
  };
  return (
    <div
      className="zen-overlay-form"
      data-workspace-preview={color}
      style={{ "--zen-space-color": color } as CSSProperties}
    >
      <form className="zen-overlay-form-fields" onSubmit={save}>
        <label>
          Workspace name
          <input
            data-autofocus
            disabled={Boolean(action.busy)}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Work, Personal, Research"
            required
            value={name}
          />
        </label>
        <fieldset
          aria-label="Suggested workspace colors"
          className="zen-overlay-swatches"
        >
          {SPACE_COLORS.map((swatch) => (
            <button
              aria-label={`Use ${swatch}`}
              aria-pressed={swatch === color}
              disabled={Boolean(action.busy)}
              key={swatch}
              onClick={() => setColor(swatch)}
              style={{ background: swatch }}
              type="button"
            >
              {swatch === color && <Check size={14} />}
            </button>
          ))}
        </fieldset>
        <SurfaceButton
          disabled={Boolean(action.busy) || !name.trim()}
          type="submit"
          variant="primary"
        >
          {space ? "Save changes" : "Create workspace"}
        </SurfaceButton>
      </form>
      {space && (
        <>
          <FolderManager invoke={invoke} space={space} state={state} />
          <div className="zen-overlay-divider" />
          {confirm ? (
            <fieldset
              aria-label="Confirm workspace deletion"
              className="zen-overlay-confirm"
            >
              <p>
                Delete “{space.name}” and close its{" "}
                {state.tabs.filter((tab) => tab.spaceId === space.id).length}{" "}
                tabs? This cannot be undone.
              </p>
              <div className="zen-overlay-actions">
                <SurfaceButton
                  disabled={Boolean(action.busy) || state.spaces.length <= 1}
                  onClick={() =>
                    void action.run(
                      "Deleting workspace",
                      () =>
                        checkedInvoke(invoke, ARC_IPC.deleteSpace, space.id),
                      done
                    )
                  }
                  variant="danger"
                >
                  Delete workspace
                </SurfaceButton>
                <SurfaceButton
                  disabled={Boolean(action.busy)}
                  onClick={() => setConfirm(false)}
                >
                  Cancel
                </SurfaceButton>
              </div>
            </fieldset>
          ) : (
            <SurfaceButton
              disabled={state.spaces.length <= 1 || Boolean(action.busy)}
              icon={Trash2}
              onClick={() => setConfirm(true)}
              variant="danger"
            >
              Delete workspace
            </SurfaceButton>
          )}
          {state.spaces.length <= 1 && (
            <p className="zen-overlay-help">Keep at least one workspace.</p>
          )}
        </>
      )}
      <ActionStatus {...action} />
    </div>
  );
}

function FolderManager({
  state,
  invoke,
  space,
}: Pick<UtilityProps, "state" | "invoke"> & { space: Space }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const action = useSurfaceAction();
  return (
    <section
      aria-label="Workspace folders"
      className="zen-overlay-folder-manager"
    >
      <h2>Folders</h2>
      {state.folders
        .filter((folder) => folder.spaceId === space.id)
        .map((folder) => (
          <div className="zen-overlay-folder-row" key={folder.id}>
            <SurfaceButton
              aria-label={`${folder.collapsed ? "Expand" : "Collapse"} ${folder.name}`}
              className="zen-overlay-icon-button"
              disabled={Boolean(action.busy)}
              icon={folder.collapsed ? Folder : FolderOpen}
              onClick={() =>
                void action.run("Updating folder", () =>
                  checkedInvoke(invoke, "arc:updateFolder", {
                    id: folder.id,
                    patch: { collapsed: !folder.collapsed },
                  })
                )
              }
            />
            <span className="zen-overlay-text">{folder.name}</span>
            <SurfaceButton
              aria-label={`Rename ${folder.name}`}
              className="zen-overlay-icon-button"
              disabled={Boolean(action.busy)}
              icon={Pencil}
              onClick={() => {
                setEditing(folder.id);
                setName(folder.name);
              }}
            />
            <SurfaceButton
              aria-label={`Remove folder ${folder.name}, keeping its tabs`}
              className="zen-overlay-icon-button"
              disabled={Boolean(action.busy)}
              icon={Trash2}
              onClick={() =>
                void action.run("Removing folder", () =>
                  checkedInvoke(invoke, ARC_IPC.deleteFolder, folder.id)
                )
              }
              title="Remove folder, keep tabs"
            />
          </div>
        ))}
      {editing ? (
        <form
          className="zen-overlay-form-fields"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(
              "Saving folder",
              () =>
                checkedInvoke(
                  invoke,
                  editing === "new" ? ARC_IPC.createFolder : "arc:updateFolder",
                  editing === "new"
                    ? { name: name.trim(), spaceId: space.id }
                    : { id: editing, patch: { name: name.trim() } }
                ),
              () => {
                setEditing(null);
                setName("");
              }
            );
          }}
        >
          <label>
            Folder name
            <input
              data-autofocus
              disabled={Boolean(action.busy)}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <div className="zen-overlay-actions">
            <SurfaceButton
              disabled={!name.trim() || Boolean(action.busy)}
              type="submit"
            >
              Save folder
            </SurfaceButton>
            <SurfaceButton
              disabled={Boolean(action.busy)}
              onClick={() => setEditing(null)}
            >
              Cancel
            </SurfaceButton>
          </div>
        </form>
      ) : (
        <SurfaceButton
          disabled={Boolean(action.busy)}
          icon={Plus}
          onClick={() => {
            setEditing("new");
            setName("");
          }}
        >
          New folder
        </SurfaceButton>
      )}
      <ActionStatus {...action} />
    </section>
  );
}

function HistoryPanel({ state, invoke, close }: UtilityProps) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<"history" | "archive">("history");
  const [confirm, setConfirm] = useState(false);
  const action = useSurfaceAction();
  const history = historyEntries(state);
  const needle = query.trim().toLocaleLowerCase();
  const rows = (
    section === "history"
      ? history.map((entry) => ({ ...entry, time: entry.visitedAt }))
      : state.archive.map((entry) => ({ ...entry, time: entry.archivedAt }))
  )
    .filter((entry) =>
      `${entry.title} ${entry.url}`.toLocaleLowerCase().includes(needle)
    )
    .sort((a, b) => b.time - a.time);
  return (
    <>
      <PanelHeader close={close} title="History & archive" />
      <div className="zen-overlay-toolbar">
        <fieldset aria-label="History source" className="zen-overlay-segmented">
          <button
            aria-pressed={section === "history"}
            onClick={() => {
              setSection("history");
              setConfirm(false);
            }}
            type="button"
          >
            History
          </button>
          <button
            aria-pressed={section === "archive"}
            onClick={() => {
              setSection("archive");
              setConfirm(false);
            }}
            type="button"
          >
            Archived tabs
          </button>
        </fieldset>
        <SurfaceButton
          disabled={
            Boolean(action.busy) ||
            !(section === "history" ? history.length : state.archive.length)
          }
          icon={Trash2}
          onClick={() => setConfirm(true)}
        >
          Clear
        </SurfaceButton>
      </div>
      <label className="zen-overlay-search">
        <Search aria-hidden="true" size={16} />
        <input
          aria-label={`Search ${section}`}
          data-autofocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title or address"
          value={query}
        />
      </label>
      {confirm && (
        <div className="zen-overlay-confirm">
          <p>
            {section === "history"
              ? "Clear all browsing history? Open tabs and archived tabs are kept."
              : "Clear all archived tabs? They will no longer be available to restore."}
          </p>
          <div className="zen-overlay-actions">
            <SurfaceButton
              disabled={Boolean(action.busy)}
              onClick={() =>
                void action.run(
                  "Clearing",
                  () =>
                    checkedInvoke(
                      invoke,
                      section === "history"
                        ? "arc:clearHistory"
                        : ARC_IPC.clearArchive
                    ),
                  () => setConfirm(false)
                )
              }
              variant="danger"
            >
              Clear {section === "history" ? "history" : "archive"}
            </SurfaceButton>
            <SurfaceButton
              disabled={Boolean(action.busy)}
              onClick={() => setConfirm(false)}
            >
              Cancel
            </SurfaceButton>
          </div>
        </div>
      )}
      <ActionStatus {...action} />
      <div className="zen-overlay-list zen-overlay-scroll">
        {rows.map((entry) => (
          <button
            className="zen-overlay-history-row"
            disabled={Boolean(action.busy)}
            key={entry.id}
            onClick={() =>
              void action.run(
                section === "history" ? "Opening page" : "Restoring tab",
                () =>
                  checkedInvoke(
                    invoke,
                    section === "history" ? ARC_IPC.newTab : ARC_IPC.restoreTab,
                    section === "history" ? { url: entry.url } : entry.id
                  ),
                close
              )
            }
            type="button"
          >
            {section === "history" ? (
              <History aria-hidden="true" size={17} />
            ) : (
              <Archive aria-hidden="true" size={17} />
            )}
            <span className="zen-overlay-text">
              <strong>{entry.title || entry.url}</strong>
              <small>{displayHost(entry.url)}</small>
            </span>
            <span className="zen-overlay-history-meta">
              <time dateTime={new Date(entry.time).toISOString()}>
                {new Date(entry.time).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                })}
              </time>
              <small>{section === "history" ? "Open" : "Restore"} ↗</small>
            </span>
          </button>
        ))}
        {!rows.length && (
          <EmptyState
            icon={section === "history" ? History : Archive}
            title={
              query
                ? "No matches"
                : section === "history"
                  ? "Your history starts here"
                  : "No archived tabs"
            }
          >
            {query
              ? "Try another title or address."
              : section === "history"
                ? "Pages you visit appear here."
                : "Archived tabs will be ready to restore here."}
          </EmptyState>
        )}
      </div>
    </>
  );
}

function useRemoteList<T>(
  invoke: UtilityProps["invoke"],
  channel: string,
  poll = false
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    const generation = current.current;
    const request = (async () => {
      try {
        const result = await checkedInvoke<T[]>(invoke, channel);
        if (!Array.isArray(result))
          throw new Error(
            "The browser returned an unexpected list. Try refreshing."
          );
        if (current.current === generation) {
          setItems(result);
          setError(null);
        }
      } catch (cause) {
        if (current.current === generation) setError(errorMessage(cause));
      } finally {
        if (current.current === generation) {
          setLoading(false);
          inflight.current = null;
        }
      }
    })();
    inflight.current = request;
    return request;
  }, [invoke, channel]);
  useEffect(() => {
    current.current++;
    inflight.current = null;
    void refresh();
    const unsubscribe = window.zenmium?.on(CHROME_IPC.event, () => {
      void refresh();
    });
    const timer = poll
      ? window.setInterval(() => {
          void refresh();
        }, 1000)
      : undefined;
    return () => {
      current.current++;
      unsubscribe?.();
      window.clearInterval(timer);
    };
  }, [refresh, poll]);
  return { error, items, loading, refresh };
}

function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B", "KB", "MB", "GB"][unit]}`;
}

function DownloadsPanel({ invoke, close }: UtilityProps) {
  const list = useRemoteList<DownloadRecord>(
    invoke,
    CHROME_IPC.downloads,
    true
  );
  const action = useSurfaceAction();
  const act = (
    item: DownloadRecord,
    kind: "pause" | "resume" | "cancel" | "show" | "open"
  ) =>
    void action.run(
      {
        cancel: "Cancelling download",
        open: "Opening file",
        pause: "Pausing download",
        resume: "Resuming download",
        show: "Showing in folder",
      }[kind],
      async () => {
        await checkedInvoke(invoke, CHROME_IPC.downloadAction, {
          action: kind,
          id: item.id,
        });
        await list.refresh();
      }
    );
  return (
    <>
      <PanelHeader close={close} title="Downloads" />
      <div className="zen-overlay-toolbar">
        <p className="zen-overlay-help">{list.items.length} downloads</p>
        <SurfaceButton
          disabled={list.loading || Boolean(action.busy)}
          icon={RotateCcw}
          onClick={() => void list.refresh()}
        >
          Refresh
        </SurfaceButton>
      </div>
      <ActionStatus
        busy={action.busy ?? (list.loading ? "Loading downloads" : null)}
        error={action.error ?? list.error}
      />
      <div className="zen-overlay-list zen-overlay-scroll">
        {list.items
          .slice()
          .sort((a, b) => b.startedAt - a.startedAt)
          .map((item) => {
            const inProgress = item.state === "progressing";
            const percent =
              item.total > 0
                ? Math.min(100, Math.max(0, (item.received / item.total) * 100))
                : undefined;
            return (
              <article className="zen-overlay-download" key={item.id}>
                <div className="zen-overlay-list-row">
                  <span className="zen-overlay-file-icon">
                    <File aria-hidden="true" size={21} />
                  </span>
                  <div className="zen-overlay-text">
                    <h2>{item.filename}</h2>
                    <small>{displayHost(item.url)}</small>
                  </div>
                </div>
                {inProgress && (
                  <progress
                    aria-label={`Download progress for ${item.filename}`}
                    max={100}
                    value={percent}
                  />
                )}
                <p className="zen-overlay-help">
                  {item.paused && inProgress
                    ? "Paused"
                    : item.state === "completed"
                      ? "Completed"
                      : item.state === "interrupted"
                        ? "Interrupted"
                        : item.state === "cancelled"
                          ? "Cancelled"
                          : "Downloading"}{" "}
                  · {bytes(item.received)}
                  {item.total > 0 ? ` of ${bytes(item.total)}` : ""}
                </p>
                <div className="zen-overlay-actions">
                  {(inProgress || item.state === "interrupted") && (
                    <SurfaceButton
                      disabled={Boolean(action.busy)}
                      icon={
                        item.paused || item.state === "interrupted"
                          ? Play
                          : Pause
                      }
                      onClick={() =>
                        act(
                          item,
                          item.paused || item.state === "interrupted"
                            ? "resume"
                            : "pause"
                        )
                      }
                    >
                      {item.paused || item.state === "interrupted"
                        ? "Resume"
                        : "Pause"}
                    </SurfaceButton>
                  )}
                  {(inProgress || item.state === "interrupted") && (
                    <SurfaceButton
                      disabled={Boolean(action.busy)}
                      icon={X}
                      onClick={() => act(item, "cancel")}
                    >
                      Cancel
                    </SurfaceButton>
                  )}
                  {item.state === "completed" && (
                    <>
                      <SurfaceButton
                        disabled={Boolean(action.busy) || !item.path}
                        icon={ArrowUpRight}
                        onClick={() => act(item, "open")}
                      >
                        Open file
                      </SurfaceButton>
                      <SurfaceButton
                        disabled={Boolean(action.busy) || !item.path}
                        icon={FolderOpen}
                        onClick={() => act(item, "show")}
                      >
                        Show in folder
                      </SurfaceButton>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        {!list.loading && !list.error && !list.items.length && (
          <EmptyState icon={Download} title="No downloads yet">
            Files you download appear here.
          </EmptyState>
        )}
      </div>
    </>
  );
}

function ExtensionsPanel({ state, invoke, close }: UtilityProps) {
  const list = useRemoteList<BrowserExtension>(invoke, CHROME_IPC.extensions);
  const action = useSurfaceAction();
  const activeUrl = state.tabs.find((tab) => tab.id === state.activeTabId)?.url ?? "";
  const storeUrl = /^https:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com)\//i.test(activeUrl)
    ? activeUrl
    : "";
  const subscribeToStoreInstall = useCallback(
    (listener: (progress: StoreInstallProgress) => void) => {
      const bridge = window.zenmium;
      return bridge
        ? bridge.on(STORE_INSTALL_IPC.progress, (value) => listener(value as StoreInstallProgress))
        : () => {};
    },
    [],
  );
  const installFromStore = useCallback(
    (target: string): Promise<StoreInstallResult> =>
      checkedInvoke<StoreInstallResult>(invoke, STORE_INSTALL_IPC.start, target),
    [invoke],
  );
  return (
    <>
      <PanelHeader close={close} title="Extensions" />
      <div className="zen-overlay-toolbar">
        <SurfaceButton
          disabled={Boolean(action.busy)}
          icon={Plus}
          onClick={() =>
            void action.run("Choosing extension directory", async () => {
              await checkedInvoke(invoke, CHROME_IPC.extensionLoad);
              await list.refresh();
            })
          }
        >
          Load unpacked
        </SurfaceButton>
        <SurfaceButton
          aria-label="Refresh extensions"
          disabled={list.loading || Boolean(action.busy)}
          icon={RotateCcw}
          onClick={() => void list.refresh()}
        />
      </div>
      <p className="zen-overlay-note">
        <Info aria-hidden="true" size={16} />
        <span>
          Install a Chrome Web Store package into this Workspace, or load an
          unpacked folder. Native messaging still depends on the extension and
          provider supporting Electron.
        </span>
      </p>
      <div className="zen-extension-store-install">
        <StoreInstall
          buttonLabel="Install"
          className="zen-extension-store-form"
          defaultValue={storeUrl}
          heading="Install from Chrome Web Store"
          install={installFromStore}
          subscribe={subscribeToStoreInstall}
        />
        <SurfaceButton
          icon={ArrowUpRight}
          onClick={() =>
            void checkedInvoke(invoke, ARC_IPC.newTab, {
              spaceId: state.activeSpaceId,
              url: "https://chromewebstore.google.com/",
            })
          }
        >
          Open Web Store
        </SurfaceButton>
      </div>
      <ActionStatus
        busy={action.busy ?? (list.loading ? "Loading extensions" : null)}
        error={action.error ?? list.error}
      />
      <div className="zen-overlay-list zen-overlay-scroll">
        {list.items.map((extension) => (
          <div className="zen-overlay-extension" key={extension.id}>
            <Puzzle aria-hidden="true" size={22} />
            <div className="zen-overlay-text">
              <h2>{extension.name}</h2>
              <small>Version {extension.version}</small>
            </div>
            <button
              aria-label={`${extension.pinned ? "Unpin" : "Pin"} ${extension.name} in the sidebar`}
              aria-pressed={extension.pinned}
              className="zen-extension-pin-toggle"
              disabled={Boolean(action.busy)}
              onClick={() =>
                void action.run(
                  `${extension.pinned ? "Unpinning" : "Pinning"} ${extension.name}`,
                  async () => {
                    await checkedInvoke(invoke, CHROME_IPC.extensionPinned, {
                      id: extension.id,
                      pinned: !extension.pinned,
                    });
                    await list.refresh();
                  },
                )
              }
              title={extension.pinned ? "Remove from sidebar" : "Pin to sidebar"}
              type="button"
            >
              <Pin aria-hidden="true" size={14} />
            </button>
            <label className="zen-overlay-switch">
              <input
                aria-checked={extension.enabled}
                aria-label={`Enable ${extension.name}`}
                checked={extension.enabled}
                disabled={Boolean(action.busy)}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  void action.run(
                    `${enabled ? "Enabling" : "Disabling"} ${extension.name}`,
                    async () => {
                      await checkedInvoke(invoke, CHROME_IPC.extensionEnabled, {
                        enabled,
                        id: extension.id,
                      });
                      await list.refresh();
                    }
                  );
                }}
                role="switch"
                type="checkbox"
              />
              <span aria-hidden="true" />
            </label>
          </div>
        ))}
        {!list.loading && !list.error && !list.items.length && (
          <EmptyState icon={Puzzle} title="Make it yours">
            Load an unpacked extension to get started.
          </EmptyState>
        )}
      </div>
    </>
  );
}

function SettingsPanel({ state, ui, invoke, close }: UtilityProps) {
  const p = ui.preferences;
  const [width, setWidth] = useState(p.width);
  const [tint, setTint] = useState(p.glassTint);
  const action = useSurfaceAction();
  const activeSpace = state.spaces.find(
    (space) => space.id === state.activeSpaceId
  );
  const themeOptions = Array.from(
    new Map([
      ...state.spaces.map((space) => [space.color, space.name] as const),
      ...SPACE_COLORS.map(
        (color, index) => [color, `Workspace color ${index + 1}`] as const
      ),
    ])
  ).map(([color, label]) => ({ color, label }));
  useEffect(() => setWidth(p.width), [p.width]);
  useEffect(() => setTint(p.glassTint), [p.glassTint]);
  const patch = (change: Partial<BrowserPreferences>) =>
    void action.run("Saving preferences", () =>
      checkedInvoke(invoke, CHROME_IPC.preferences, change)
    );
  return (
    <>
      <PanelHeader
        close={close}
        subtitle="Make room for your way of browsing"
        title="Settings"
      />
      <div className="zen-overlay-settings zen-overlay-scroll">
        <h2>Appearance</h2>
        <label className="zen-overlay-setting">
          <span>Theme</span>
          <select
            disabled={Boolean(action.busy)}
            onChange={(event) =>
              patch({
                theme: event.target.value as BrowserPreferences["theme"],
              })
            }
            value={p.theme}
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <div className="zen-overlay-setting zen-overlay-theme-setting">
          <span>
            Theme color
            <small>Sets the active workspace accent</small>
          </span>
          <ThemeColorPicker value={activeSpace?.color ?? SPACE_COLORS[0]} options={themeOptions} disabled={Boolean(action.busy) || !activeSpace}
            onChange={(color) => activeSpace && void action.run("Changing theme color", () => checkedInvoke(invoke, ARC_IPC.updateSpace, {id: activeSpace.id, patch: {color}}))}/>
        </div>
        <label className="zen-overlay-setting zen-overlay-range-setting">
          <span>
            Glass tint
            <small>Blend more workspace color into the liquid glass</small>
          </span>
          <span className="zen-overlay-range-control">
            <input
              aria-label="Glass tint percentage"
              disabled={Boolean(action.busy)}
              max={100}
              min={0}
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                setTint(value);
                document.documentElement.style.setProperty("--zen-glass-tint-amount", `${value}%`);
              }}
              onPointerUp={(event) => patch({glassTint: event.currentTarget.valueAsNumber})}
              onKeyUp={(event) => patch({glassTint: event.currentTarget.valueAsNumber})}
              onBlur={() => { if (tint !== p.glassTint) patch({glassTint: tint}); }}
              step={1}
              type="range"
              value={tint}
            />
            <output>{tint}%</output>
          </span>
        </label>
        <PreferenceSwitch
          change={(themedChatWindow) => patch({ themedChatWindow })}
          checked={p.themedChatWindow}
          disabled={Boolean(action.busy)}
          label="Themed chat window"
        />
        <label className="zen-overlay-setting">
          <span>Sidebar side</span>
          <select
            disabled={Boolean(action.busy)}
            onChange={(event) =>
              patch({ side: event.target.value as BrowserPreferences["side"] })
            }
            value={p.side}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className="zen-overlay-setting">
          <span>Sidebar mode</span>
          <select
            disabled={Boolean(action.busy)}
            onChange={(event) =>
              patch({
                sidebarMode: event.target
                  .value as BrowserPreferences["sidebarMode"],
              })
            }
            value={p.sidebarMode === "expanded" ? "expanded" : "collapsed"}
          >
            <option value="expanded">Expanded</option>
            <option value="collapsed">Hover reveal</option>
          </select>
        </label>
        <form
          className="zen-overlay-width-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (Number.isInteger(width) && width >= 200 && width <= 420)
              patch({ width });
          }}
        >
          <label className="zen-overlay-setting">
            <span>
              Sidebar width <small>200–420 px</small>
            </span>
            <input
              aria-label="Sidebar width in pixels"
              disabled={Boolean(action.busy)}
              max={420}
              min={200}
              onChange={(event) => setWidth(event.target.valueAsNumber)}
              required
              step={1}
              type="number"
              value={Number.isNaN(width) ? "" : width}
            />
          </label>
          <SurfaceButton
            disabled={
              Boolean(action.busy) ||
              width === p.width ||
              !Number.isInteger(width) ||
              width < 200 ||
              width > 420
            }
            type="submit"
          >
            Apply width
          </SurfaceButton>
        </form>
        <h2>Browsing</h2>
        <label className="zen-overlay-setting">
          <span>Search engine</span>
          <select
            disabled={Boolean(action.busy)}
            onChange={(event) =>
              patch({
                searchEngine: event.target
                  .value as BrowserPreferences["searchEngine"],
              })
            }
            value={p.searchEngine}
          >
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="google">Google</option>
          </select>
        </label>
        <PreferenceSwitch
          change={(newTabAtTop) => patch({ newTabAtTop })}
          checked={p.newTabAtTop}
          disabled={Boolean(action.busy)}
          label="New tab button at the top"
        />
        <PreferenceSwitch
          change={(bookmarksBar) => patch({ bookmarksBar })}
          checked={p.bookmarksBar}
          disabled={Boolean(action.busy)}
          label="Show overflow essentials as bookmarks"
        />
        <NativeSettings state={state} ui={ui} invoke={invoke}/>
      </div>
      <ActionStatus {...action} />
    </>
  );
}

function PreferenceSwitch({
  label,
  checked,
  disabled,
  change,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  change: (value: boolean) => void;
}) {
  return (
    <label className="zen-overlay-setting">
      <span>{label}</span>
      <span className="zen-overlay-switch">
        <input
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(event) => change(event.target.checked)}
          role="switch"
          type="checkbox"
        />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}

function SiteInfoPanel({ state, ui, close }: UtilityProps) {
  const tab = state.tabs.find(
    (item) => item.id === (ui.overlay?.tabId ?? state.activeTabId)
  );
  let url: URL | null = null;
  try {
    if (tab) url = new URL(tab.url);
  } catch {
    /* A page may be between navigations. */
  }
  const https = url?.protocol === "https:";
  const http = url?.protocol === "http:";
  const Icon = https ? LockKeyhole : http ? ShieldAlert : Info;
  return (
    <>
      <PanelHeader close={close} title="Site information" />
      <div className="zen-overlay-site-info">
        <Icon aria-hidden="true" size={30} strokeWidth={1.4} />
        <h2>
          {url?.origin && url.origin !== "null"
            ? url.origin
            : (tab?.url ?? "No active page")}
        </h2>
        <strong>
          {https
            ? "HTTPS connection"
            : http
              ? "HTTP connection"
              : "Browser or local page"}
        </strong>
        <p>
          {https
            ? "This address uses HTTPS, the encrypted HTTP protocol over TLS. Certificate details are not available in this panel."
            : http
              ? "This address uses HTTP. Traffic to this site is not encrypted with TLS."
              : "This page does not have an HTTP or HTTPS origin."}
        </p>
      </div>
    </>
  );
}
