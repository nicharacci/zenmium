import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import {
  BrowserWindow,
  clipboard,
  Menu,
  shell,
  WebContentsView,
} from "electron";
import type {
  ArchiveEntry,
  ArcState,
  Folder,
  Rect,
  Space,
  Tab,
  TabUpdate,
} from "../shared/ipc";
import { emptyState, getPaneTabIds, SPACE_COLORS } from "../shared/ipc";
import { resolveAddress } from "../shared/navigation";
import { JsonStore } from "./state-store";

const id = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;
const ARCHIVE_AFTER_MS = 12 * 60 * 60 * 1000;
const sameBounds = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Arc owns browser state and Chromium. Renderers send commands and mirror snapshots. */
export class ArcCore {
  private readonly store: JsonStore<ArcState>;
  private readonly views = new Map<string, WebContentsView>();
  private readonly emitter = new EventEmitter();
  private state: ArcState;
  private bounds: Rect = { height: 0, width: 0, x: 8, y: 8 };
  private peek: WebContentsView | null = null;
  private peekBounds: Rect = { height: 0, width: 0, x: 0, y: 0 };
  private persistTimer: NodeJS.Timeout | null = null;
  private archiveTimer: NodeJS.Timeout;
  private disposed = false;
  private started = false;
  private lastActivation = 0;
  private searchEngine: "duckduckgo" | "google" = "duckduckgo";
  private raiseChrome: () => void = () => {};
  private keyboardHandler: (wc: Electron.WebContents) => void = () => {};

  constructor(
    private readonly win: BrowserWindow,
    userDataDir: string
  ) {
    this.store = new JsonStore(userDataDir, "state.json");
    this.state = this.normalize(this.store.read(emptyState()));
    this.lastActivation = this.state.tabs.reduce(
      (latest, tab) =>
        Math.max(
          latest,
          Number.isFinite(tab.lastActiveAt) ? tab.lastActiveAt : 0
        ),
      0
    );
    this.archiveTimer = setInterval(() => this.autoArchive(), 5 * 60 * 1000);
  }
  private normalize(raw: ArcState): ArcState {
    const state: ArcState = {
      ...emptyState(),
      ...raw,
      glance: null,
      splitPrimaryTabId: null,
      splitTabId: null,
    };
    state.spaces = Array.isArray(state.spaces) ? state.spaces : [];
    if (!state.spaces.length)
      state.spaces.push({
        color: SPACE_COLORS[0],
        icon: "◎",
        id: id("sp"),
        name: "Space",
      });
    if (!state.spaces.some((s) => s.id === state.activeSpaceId))
      state.activeSpaceId = state.spaces[0]!.id;
    state.tabs = (Array.isArray(state.tabs) ? state.tabs : []).map((tab) => ({
      ...tab,
      audio: false,
      blocked: false,
      canGoBack: false,
      canGoForward: false,
      discarded: tab.url !== "about:blank",
      error: null,
      glance: false,
      loading: false,
      pinnedUrl: tab.kind === "pinned" ? (tab.pinnedUrl ?? tab.url) : undefined,
      spaceId: state.spaces.some((s) => s.id === tab.spaceId)
        ? tab.spaceId
        : state.activeSpaceId,
    }));
    state.folders = Array.isArray(state.folders) ? state.folders : [];
    state.archive = Array.isArray(state.archive) ? state.archive : [];
    state.history = Array.isArray(state.history) ? state.history : [];
    return state;
  }
  onState(listener: (state: ArcState) => void): () => void {
    this.emitter.on("state", listener);
    return () => this.emitter.off("state", listener);
  }
  setChromeCallbacks(
    raise: () => void,
    keyboard: (wc: Electron.WebContents) => void
  ): void {
    this.raiseChrome = raise;
    this.keyboardHandler = keyboard;
  }
  setSearchEngine(engine: "duckduckgo" | "google"): void {
    this.searchEngine = engine;
  }
  snapshot(): ArcState {
    return structuredClone(this.state);
  }
  private emit(): void {
    if (this.disposed) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.store.write(this.state), 250);
    this.emitter.emit("state", this.snapshot());
  }
  boot(): void {
    if (this.started) return;
    this.started = true;
    const first =
      this.state.tabs.find(
        (t) =>
          t.id === this.state.activeTabId &&
          t.spaceId === this.state.activeSpaceId
      ) ?? this.state.tabs.find((t) => t.spaceId === this.state.activeSpaceId);
    if (first) this.activateTab(first.id);
    else this.newTab();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.archiveTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.store.write(this.state);
    this.closePeek();
    for (const view of this.views.values())
      if (!view.webContents.isDestroyed()) view.webContents.close();
    this.views.clear();
  }
  private tab(tabId: string): Tab | undefined {
    return this.state.tabs.find((t) => t.id === tabId);
  }
  private ensureView(tab: Tab): WebContentsView {
    const existing = this.views.get(tab.id);
    if (existing) return existing;
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(import.meta.dirname, "../preload/tab.cjs"),
        sandbox: true,
      },
    });
    view.setBorderRadius(10);
    view.setBackgroundColor("#ffffff");
    const wc = view.webContents;
    this.keyboardHandler(wc);
    wc.on("focus", () => {
      // Native clicks and keyboard focus must update chrome's command target,
      // without reattaching views or moving either pane during page input.
      if (
        this.disposed ||
        this.win.isDestroyed() ||
        this.state.activeTabId === tab.id ||
        !this.tab(tab.id) ||
        !getPaneTabIds(this.state).includes(tab.id) ||
        !this.win.contentView.children.includes(view)
      )
        return;
      this.selectTab(tab);
      this.emit();
    });
    wc.setAudioMuted(Boolean(tab.muted));
    wc.ipc.on("browser:glance-link", (event, url: unknown) => {
      if (
        event.senderFrame !== wc.mainFrame ||
        typeof url !== "string" ||
        !/^https?:\/\//i.test(url)
      )
        return;
      this.openPeek(url);
    });
    wc.on("context-menu", (_event, params) => {
      const items: Electron.MenuItemConstructorOptions[] = [];
      if (/^https?:\/\//i.test(params.linkURL))
        items.push(
          {
            click: () => this.newTab({ url: params.linkURL }),
            label: "Open Link in New Tab",
          },
          {
            click: () => this.openPeek(params.linkURL),
            label: "Open Link in Glance",
          },
          {
            click: () => clipboard.writeText(params.linkURL),
            label: "Copy Link",
          },
          { type: "separator" }
        );
      if (params.isEditable)
        items.push(
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
          { type: "separator" }
        );
      else if (params.selectionText)
        items.push(
          { click: () => wc.copy(), label: "Copy" },
          { type: "separator" }
        );
      items.push(
        {
          click: () => this.back(tab.id),
          enabled: wc.navigationHistory.canGoBack(),
          label: "Back",
        },
        {
          click: () => this.forward(tab.id),
          enabled: wc.navigationHistory.canGoForward(),
          label: "Forward",
        },
        { click: () => this.reload(tab.id), label: "Reload" }
      );
      Menu.buildFromTemplate(items).popup({ window: this.win });
    });
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (/^https?:/.test(url)) {
        if (disposition === "new-window") this.openPeek(url);
        else this.newTab({ url });
      } else if (/^(mailto|tel):/.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    const refreshNavigation = () => {
      const t = this.tab(tab.id);
      if (!t || wc.isDestroyed()) return;
      t.canGoBack = wc.navigationHistory.canGoBack();
      t.canGoForward = wc.navigationHistory.canGoForward();
      const url = wc.getURL();
      if (url) t.url = url;
      t.pinnedChanged = Boolean(t.pinnedUrl && t.url !== t.pinnedUrl);
      this.emit();
    };
    wc.on("page-title-updated", () => {
      const t = this.tab(tab.id);
      if (t) {
        t.title = t.customTitle || wc.getTitle() || t.url;
        this.emit();
      }
    });
    wc.on("page-favicon-updated", (_event, icons) => {
      const t = this.tab(tab.id);
      if (t) {
        t.faviconUrl = icons.find((icon) =>
          /^(https?:|data:image\/)/i.test(icon)
        );
        this.emit();
      }
    });
    wc.on("did-navigate", refreshNavigation);
    wc.on("did-navigate-in-page", refreshNavigation);
    wc.on("did-start-loading", () => {
      const t = this.tab(tab.id);
      if (t) {
        t.loading = true;
        t.error = null;
        t.discarded = false;
        this.emit();
      }
    });
    wc.on("did-stop-loading", () => {
      const t = this.tab(tab.id);
      if (!t) return;
      t.loading = false;
      t.title = t.customTitle || wc.getTitle() || t.url;
      refreshNavigation();
      if (/^https?:/.test(t.url) && !t.error)
        this.state.history = [
          {
            id: id("visit"),
            title: t.title,
            url: t.url,
            visitedAt: Date.now(),
          },
          ...(this.state.history ?? []).filter((h) => h.url !== t.url),
        ].slice(0, 1000);
      this.emit();
    });
    wc.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
      if (code === -3 || !mainFrame) return;
      const t = this.tab(tab.id);
      if (t) {
        t.loading = false;
        t.error = description;
        this.attachActive();
        this.emit();
      }
    });
    wc.on("media-started-playing", () => {
      const t = this.tab(tab.id);
      if (t) {
        t.audio = true;
        this.emit();
      }
    });
    wc.on("media-paused", () => {
      const t = this.tab(tab.id);
      if (t) {
        t.audio = false;
        this.emit();
      }
    });
    wc.on("render-process-gone", () => {
      const t = this.tab(tab.id);
      if (t) {
        t.error = "This tab stopped responding. Reload to continue.";
        t.loading = false;
        this.attachActive();
        this.emit();
      }
    });
    this.views.set(tab.id, view);
    tab.discarded = false;
    void wc.loadURL(tab.url).catch(() => {});
    return view;
  }
  private attachActive(): void {
    if (this.win.isDestroyed()) return;
    const wanted = getPaneTabIds(this.state);
    const rects = this.splitRects(wanted.length === 2);
    for (const [tabId, view] of this.views)
      if (
        (!wanted.includes(tabId) ||
          this.tab(tabId)?.error ||
          this.tab(tabId)?.url === "about:blank") &&
        this.win.contentView.children.includes(view)
      )
        this.win.contentView.removeChildView(view);
    wanted.forEach((tabId, index) => {
      const tab = this.tab(tabId);
      if (!tab || tab.url === "about:blank" || tab.error) return;
      const view = this.ensureView(tab);
      if (!sameBounds(view.getBounds(), rects[index]!))
        view.setBounds(rects[index]!);
      if (!this.win.contentView.children.includes(view))
        this.win.contentView.addChildView(view);
    });
    this.raiseChrome();
  }
  private splitRects(split: boolean): Rect[] {
    if (!split) return [this.bounds];
    const { x, y, width, height } = this.bounds;
    const gap = Math.min(8, width);
    const half = Math.floor((width - gap) / 2);
    return [
      { height, width: half, x, y },
      { height, width: width - half - gap, x: x + half + gap, y },
    ];
  }
  setContentBounds(rect: Rect): void {
    if (sameBounds(this.bounds, rect)) return;
    this.bounds = rect;
    this.attachActive();
  }
  focusActive(): void {
    if (this.disposed || this.win.isDestroyed()) return;
    const view = this.views.get(this.state.activeTabId ?? "");
    if (
      view &&
      !view.webContents.isDestroyed() &&
      this.win.contentView.children.includes(view)
    )
      view.webContents.focus();
    else this.win.webContents.focus();
  }
  getActiveWebContents(): Electron.WebContents | undefined {
    return this.views.get(this.state.activeTabId ?? "")?.webContents;
  }
  private clearSplit(): void {
    this.state.splitTabId = null;
    this.state.splitPrimaryTabId = null;
  }
  private selectTab(tab: Tab): void {
    if (tab.spaceId !== this.state.activeSpaceId) this.clearSplit();
    this.state.activeSpaceId = tab.spaceId;
    const primary = getPaneTabIds(this.state)[0];
    if (this.state.splitTabId) this.state.splitPrimaryTabId = primary ?? null;
    if (this.state.splitTabId === tab.id)
      this.state.splitTabId = this.state.activeTabId;
    else if (this.state.splitTabId && primary === this.state.activeTabId)
      this.state.splitPrimaryTabId = tab.id;
    this.state.activeTabId = tab.id;
    // Millisecond ties otherwise select an older tab on close/workspace return.
    this.lastActivation = Math.max(Date.now(), this.lastActivation + 1);
    tab.lastActiveAt = this.lastActivation;
  }
  activateTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    this.selectTab(tab);
    if (tab.url !== "about:blank") this.ensureView(tab);
    this.attachActive();
    this.emit();
    this.focusActive();
  }
  updateTab(tabId: string, patch: TabUpdate): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    if (patch.title !== undefined || patch.customTitle !== undefined) {
      tab.customTitle =
        (patch.customTitle ?? patch.title ?? "").trim() || undefined;
      tab.title =
        tab.customTitle ||
        this.views.get(tabId)?.webContents.getTitle() ||
        tab.url;
    }
    if ("iconUrl" in patch) tab.iconUrl = patch.iconUrl ?? undefined;
    if (patch.pinnedUrl !== undefined && tab.kind === "pinned") {
      tab.pinnedUrl = resolveAddress(patch.pinnedUrl, this.searchEngine);
      tab.pinnedChanged = tab.url !== tab.pinnedUrl;
    }
    if (patch.url !== undefined) {
      if (tab.kind === "pinned")
        tab.pinnedUrl = resolveAddress(patch.url, this.searchEngine);
      this.navigate(tabId, patch.url);
    }
    if (patch.muted !== undefined) {
      tab.muted = patch.muted;
      this.views.get(tabId)?.webContents.setAudioMuted(patch.muted);
    }
    if ("sublabel" in patch) tab.sublabel = patch.sublabel ?? null;
    // Playback, failures, discard and pinned-change flags are derived, never user-fabricated.
    this.emit();
  }
  newTab(
    opts: { spaceId?: string; url?: string; kind?: Tab["kind"] } = {}
  ): Tab {
    const spaceId =
      opts.spaceId && this.state.spaces.some((s) => s.id === opts.spaceId)
        ? opts.spaceId
        : this.state.activeSpaceId;
    const url = resolveAddress(opts.url ?? "", this.searchEngine);
    const tab: Tab = {
      folderId: null,
      id: id("tab"),
      kind: "today",
      lastActiveAt: Date.now(),
      loading: false,
      spaceId,
      title: url === "about:blank" ? "New Tab" : url,
      url,
    };
    if (opts.kind === "pinned") this.checkEssentialLimit(tab);
    this.state.tabs.push(tab);
    if (opts.kind === "pinned") this.pinTab(tab.id);
    this.activateTab(tab.id);
    return structuredClone(tab);
  }
  resetTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (tab?.pinnedUrl) this.navigate(tabId, tab.pinnedUrl);
  }
  closeTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    const isActive = this.state.activeTabId === tabId;
    const panes = getPaneTabIds(this.state);
    const survivor =
      panes.length === 2 && panes.includes(tabId)
        ? panes.find((paneId) => paneId !== tabId)
        : undefined;
    if (survivor) this.clearSplit();
    if (tab.kind === "pinned") {
      tab.url = tab.pinnedUrl ?? tab.url;
      tab.pinnedChanged = false;
      tab.discarded = true;
      tab.audio = false;
      tab.loading = false;
    } else {
      this.state.archive.unshift({
        archivedAt: Date.now(),
        id: tab.id,
        spaceId: tab.spaceId,
        title: tab.title,
        url: tab.url,
      });
      this.state.archive = this.state.archive.slice(0, 200);
      this.state.tabs = this.state.tabs.filter((t) => t.id !== tabId);
    }
    const view = this.views.get(tabId);
    if (view) {
      this.win.contentView.removeChildView(view);
      this.views.delete(tabId);
      view.webContents.close();
    }
    if (survivor) this.activateTab(survivor);
    else if (isActive) {
      const next = this.state.tabs
        .filter((t) => t.spaceId === tab.spaceId && t.id !== tabId)
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
      this.state.activeTabId = null;
      if (next) this.activateTab(next.id);
    }
    this.attachActive();
    this.emit();
  }
  navigate(tabId: string, input: string): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    const target = resolveAddress(input, this.searchEngine);
    tab.url = target;
    tab.error = null;
    tab.discarded = false;
    tab.pinnedChanged = Boolean(tab.pinnedUrl && tab.pinnedUrl !== target);
    const existing = this.views.get(tabId);
    if (existing) void existing.webContents.loadURL(target).catch(() => {});
    else if (target !== "about:blank") this.ensureView(tab);
    this.attachActive();
    this.emit();
  }
  back(tabId: string): void {
    const wc = this.views.get(tabId)?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }
  forward(tabId: string): void {
    const wc = this.views.get(tabId)?.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }
  stop(tabId: string): void {
    this.views.get(tabId)?.webContents.stop();
  }
  reload(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    tab.error = null;
    const wc = this.views.get(tabId)?.webContents;
    if (wc) wc.reload();
    else this.ensureView(tab);
    this.attachActive();
    this.emit();
  }
  createSpace(name: string, color?: string): Space {
    const space: Space = {
      color:
        color ?? SPACE_COLORS[this.state.spaces.length % SPACE_COLORS.length]!,
      icon: "◎",
      id: id("sp"),
      name: name.trim() || "New Space",
    };
    this.state.spaces.push(space);
    this.activateSpace(space.id);
    return space;
  }
  activateSpace(spaceId: string): void {
    if (!this.state.spaces.some((s) => s.id === spaceId)) return;
    this.state.activeSpaceId = spaceId;
    this.clearSplit();
    const next = this.state.tabs
      .filter((t) => t.spaceId === spaceId)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    if (next) this.activateTab(next.id);
    else {
      this.state.activeTabId = null;
      this.attachActive();
      this.emit();
    }
  }
  updateSpace(
    spaceId: string,
    patch: Partial<Pick<Space, "name" | "color" | "icon" | "pinnedCollapsed">>
  ): void {
    const space = this.state.spaces.find((s) => s.id === spaceId);
    if (!space) return;
    if (patch.name?.trim()) space.name = patch.name.trim();
    if (patch.color && /^#[\da-f]{6}$/i.test(patch.color))
      space.color = patch.color;
    if (patch.icon?.trim()) space.icon = patch.icon.trim().slice(0, 16);
    if (typeof patch.pinnedCollapsed === "boolean")
      space.pinnedCollapsed = patch.pinnedCollapsed;
    this.emit();
  }
  deleteSpace(spaceId: string): void {
    if (this.state.spaces.length <= 1) return;
    for (const tab of [...this.state.tabs].filter(
      (t) => t.spaceId === spaceId
    )) {
      tab.kind = "today";
      this.closeTab(tab.id);
    }
    this.state.spaces = this.state.spaces.filter((s) => s.id !== spaceId);
    this.state.folders = this.state.folders.filter(
      (f) => f.spaceId !== spaceId
    );
    if (this.state.activeSpaceId === spaceId)
      this.activateSpace(this.state.spaces[0]!.id);
    this.emit();
  }
  private checkEssentialLimit(tab: Tab, spaceId = tab.spaceId): void {
    if (
      this.state.tabs.filter(
        (t) =>
          t.spaceId === spaceId &&
          t.kind === "pinned" &&
          !t.folderId &&
          t.id !== tab.id
      ).length >= 12
    )
      throw new Error("This workspace already has 12 Essentials.");
  }
  pinTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    this.checkEssentialLimit(tab);
    tab.kind = "pinned";
    tab.folderId = null;
    tab.pinnedUrl ??= tab.url;
    this.emit();
  }
  unpinTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    tab.kind = "today";
    tab.folderId = null;
    tab.pinnedUrl = undefined;
    tab.pinnedChanged = false;
    this.emit();
  }
  createFolder(spaceId: string, name: string): Folder {
    if (!this.state.spaces.some((s) => s.id === spaceId))
      throw new Error("Workspace not found.");
    const folder: Folder = {
      collapsed: false,
      id: id("fd"),
      name: name.trim() || "Folder",
      spaceId,
    };
    this.state.folders.push(folder);
    this.emit();
    return folder;
  }
  renameFolder(folderId: string, name: string): void {
    this.updateFolder(folderId, { name });
  }
  updateFolder(
    folderId: string,
    patch: Partial<Pick<Folder, "name" | "collapsed">>
  ): void {
    const folder = this.state.folders.find((f) => f.id === folderId);
    if (!folder) return;
    if (patch.name?.trim()) folder.name = patch.name.trim();
    if (typeof patch.collapsed === "boolean")
      folder.collapsed = patch.collapsed;
    this.emit();
  }
  deleteFolder(folderId: string): void {
    this.state.folders = this.state.folders.filter((f) => f.id !== folderId);
    for (const tab of this.state.tabs)
      if (tab.folderId === folderId) {
        tab.folderId = null;
        tab.kind = "today";
        tab.pinnedUrl = undefined;
      }
    this.emit();
  }
  moveToFolder(tabId: string, folderId: string | null): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    if (folderId) {
      const folder = this.state.folders.find(
        (f) => f.id === folderId && f.spaceId === tab.spaceId
      );
      if (!folder) throw new Error("Folder not found in this workspace.");
      tab.kind = "pinned";
      tab.pinnedUrl ??= tab.url;
    } else if (tab.kind === "pinned") this.checkEssentialLimit(tab);
    tab.folderId = folderId;
    this.emit();
  }
  moveTabToSpace(tabId: string, spaceId: string): void {
    const tab = this.tab(tabId);
    if (
      !tab ||
      tab.spaceId === spaceId ||
      !this.state.spaces.some((s) => s.id === spaceId)
    )
      return;
    if (tab.kind === "pinned") this.checkEssentialLimit(tab, spaceId);
    const panes = getPaneTabIds(this.state);
    const survivor =
      panes.length === 2 && panes.includes(tabId)
        ? panes.find((paneId) => paneId !== tabId)
        : undefined;
    tab.spaceId = spaceId;
    tab.folderId = null;
    if (survivor) {
      this.clearSplit();
      this.activateTab(survivor);
    } else if (this.state.activeTabId === tab.id)
      this.activateSpace(this.state.activeSpaceId);
    this.emit();
  }
  reorderTab(tabId: string, beforeId: string | null): void {
    const tab = this.tab(tabId);
    const before = beforeId ? this.tab(beforeId) : null;
    if (
      !tab ||
      beforeId === tabId ||
      (before && before.spaceId !== tab.spaceId)
    )
      return;
    this.state.tabs = this.state.tabs.filter((t) => t.id !== tabId);
    const index = beforeId
      ? this.state.tabs.findIndex((t) => t.id === beforeId)
      : -1;
    if (index < 0) this.state.tabs.push(tab);
    else this.state.tabs.splice(index, 0, tab);
    this.emit();
  }
  archiveTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (tab?.kind === "today") this.closeTab(tabId);
  }
  restoreTab(archiveId: string): void {
    const entry = this.state.archive.find((a) => a.id === archiveId);
    if (!entry) return;
    const restored = this.newTab({ spaceId: entry.spaceId, url: entry.url });
    this.updateTab(restored.id, { title: entry.title });
    this.state.archive = this.state.archive.filter((a) => a.id !== archiveId);
    this.emit();
  }
  clearArchive(): void {
    this.state.archive = [];
    this.emit();
  }
  clearHistory(): void {
    this.state.history = [];
    this.emit();
  }
  toggleSplit(tabId: string): void {
    if (this.state.splitTabId && getPaneTabIds(this.state).includes(tabId))
      this.clearSplit();
    else {
      let tab = this.tab(tabId);
      if (tabId === this.state.activeTabId)
        tab = this.state.tabs.find(
          (t) => t.spaceId === this.state.activeSpaceId && t.id !== tabId
        );
      if (
        !tab ||
        !this.state.activeTabId ||
        tab.spaceId !== this.state.activeSpaceId
      )
        return;
      this.state.splitTabId = tab.id;
      this.state.splitPrimaryTabId = this.state.activeTabId;
      if (tab.url !== "about:blank") this.ensureView(tab);
    }
    this.attachActive();
    this.emit();
    this.focusActive();
  }
  openPeek(input: string): void {
    this.closePeek();
    const url = resolveAddress(input, this.searchEngine);
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.peek = view;
    view.setBorderRadius(10);
    this.keyboardHandler(view.webContents);
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:/.test(target)) this.newTab({ url: target });
      return { action: "deny" };
    });
    this.state.glance = { title: "Glance", url };
    view.webContents.on("page-title-updated", () => {
      if (this.state.glance) {
        this.state.glance.title = view.webContents.getTitle();
        this.emit();
      }
    });
    view.webContents.on("did-navigate", (_e, target) => {
      if (this.state.glance) {
        this.state.glance.url = target;
        this.emit();
      }
    });
    void view.webContents.loadURL(url).catch(() => {});
    this.emit();
    this.raiseChrome();
    view.webContents.focus();
  }
  setPeekBounds(bounds: Rect): void {
    this.peekBounds = bounds;
    if (this.peek && !sameBounds(this.peek.getBounds(), bounds))
      this.peek.setBounds(bounds);
  }
  raisePeek(): void {
    if (this.peek) {
      if (!sameBounds(this.peek.getBounds(), this.peekBounds))
        this.peek.setBounds(this.peekBounds);
      if (this.win.contentView.children.at(-1) !== this.peek)
        this.win.contentView.addChildView(this.peek);
    }
  }
  getPeekView(): WebContentsView | null {
    return this.peek;
  }
  closePeek(): void {
    const peek = this.peek;
    this.peek = null;
    this.state.glance = null;
    if (peek) {
      if (!this.win.isDestroyed()) this.win.contentView.removeChildView(peek);
      if (!peek.webContents.isDestroyed()) peek.webContents.close();
    }
    this.emit();
    if (peek && !this.disposed) this.focusActive();
  }
  promotePeek(): void {
    const url = this.state.glance?.url;
    this.closePeek();
    if (url) this.newTab({ url });
  }
  private autoArchive(): void {
    const cutoff = Date.now() - ARCHIVE_AFTER_MS;
    for (const tab of [...this.state.tabs])
      if (
        tab.kind === "today" &&
        tab.lastActiveAt < cutoff &&
        tab.id !== this.state.activeTabId &&
        tab.id !== this.state.splitTabId
      )
        this.closeTab(tab.id);
  }
}
export type { ArchiveEntry };
