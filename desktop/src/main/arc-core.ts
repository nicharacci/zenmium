import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { BrowserWindow, WebContentsView, shell } from "electron";
import { JsonStore } from "./state-store";
import type { ArcState, ArchiveEntry, Folder, Rect, Space, Tab, TabUpdate } from "../shared/ipc";
import { SPACE_COLORS, emptyState } from "../shared/ipc";

const HOME_URL = "https://github.com/nicharacci/zenmium";
const ARCHIVE_AFTER_MS = 12 * 60 * 60 * 1000;
const AUTO_ARCHIVE_INTERVAL_MS = 5 * 60 * 1000;

const id = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;
const now = (): number => Date.now();

/**
 * The Arc model: spaces, favorites (pinned tabs), today tabs, folders, archive,
 * split view, and peek. Owns one Chromium WebContentsView per live tab and
 * persists the model to disk. The renderer mirrors `ArcState`.
 */
export class ArcCore {
  private readonly win: BrowserWindow;
  private readonly store: JsonStore<ArcState>;
  private readonly views = new Map<string, WebContentsView>();
  private readonly emitter = new EventEmitter();
  private state: ArcState;
  private contentBounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private activeTabId: string | null = null;
  private splitTabId: string | null = null;
  private archiveTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(win: BrowserWindow, userDataDir: string) {
    this.win = win;
    this.store = new JsonStore<ArcState>(userDataDir, "state.json");
    this.state = this.normalize(this.store.read(emptyState()));
    this.archiveTimer = setInterval(() => this.autoArchive(), AUTO_ARCHIVE_INTERVAL_MS);
  }

  onState(listener: (state: ArcState) => void): () => void {
    this.emitter.on("state", listener);
    return () => this.emitter.off("state", listener);
  }

  private normalize(raw: ArcState): ArcState {
    if (raw.spaces.length === 0) {
      const space: Space = { id: id("sp"), name: "Home", color: SPACE_COLORS[0], icon: "◎" };
      raw = { ...emptyState(), spaces: [space], activeSpaceId: space.id };
    }
    if (!raw.spaces.some((s) => s.id === raw.activeSpaceId)) {
      raw.activeSpaceId = raw.spaces[0]?.id ?? "";
    }
    return raw;
  }

  private persist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.store.write(this.state), 250);
  }

  private emit(): void {
    this.persist();
    this.emitter.emit("state", this.snapshot());
  }

  snapshot(): ArcState {
    return {
      spaces: this.state.spaces,
      activeSpaceId: this.state.activeSpaceId,
      activeTabId: this.activeTabId,
      splitTabId: this.splitTabId,
      folders: this.state.folders,
      tabs: this.state.tabs,
      archive: this.state.archive,
    };
  }

  /** Boot: bring back favorites and reopen them. Today tabs start empty. */
  boot(): void {
    for (const tab of this.state.tabs.filter((t) => t.kind === "pinned")) {
      this.ensureView(tab);
      void tab;
    }
    const first = this.state.tabs.find((t) => t.spaceId === this.state.activeSpaceId) ?? null;
    if (first) this.activateTab(first.id);
    else this.newTab({ url: HOME_URL });
    this.emit();
  }

  dispose(): void {
    if (this.archiveTimer) clearInterval(this.archiveTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.store.write(this.state);
    for (const view of this.views.values()) view.webContents.close();
    this.views.clear();
  }

  private tab(tabId: string): Tab | undefined {
    return this.state.tabs.find((t) => t.id === tabId);
  }

  private ensureView(tab: Tab): WebContentsView {
    const existing = this.views.get(tab.id);
    if (existing) return existing;
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) this.newTab({ url });
      else void shell.openExternal(url);
      return { action: "deny" };
    });
    wc.on("page-title-updated", () => {
      const t = this.tab(tab.id);
      if (t) {
        t.title = wc.getTitle() || t.url;
        this.emit();
      }
    });
    wc.on("did-navigate", (_e, url) => {
      const t = this.tab(tab.id);
      if (t) {
        t.url = url;
        this.emit();
      }
    });
    wc.on("did-start-loading", () => {
      const t = this.tab(tab.id);
      if (t) {
        t.loading = true;
        this.emit();
      }
    });
    wc.on("did-stop-loading", () => {
      const t = this.tab(tab.id);
      if (t) {
        t.loading = false;
        t.title = wc.getTitle() || t.url;
        this.emit();
      }
    });
    this.views.set(tab.id, view);
    void wc.loadURL(tab.url);
    return view;
  }

  private attachActive(): void {
    const children = this.win.contentView.children;
    for (const view of this.views.values()) {
      if (children.includes(view)) this.win.contentView.removeChildView(view);
    }
    const ids = [this.activeTabId, this.splitTabId].filter((v): v is string => Boolean(v));
    const rects = this.splitRects(ids.length === 2);
    ids.forEach((tabId, index) => {
      const view = this.views.get(tabId);
      if (!view) return;
      view.setBounds(rects[index] ?? rects[0]!);
      this.win.contentView.addChildView(view);
    });
  }

  private splitRects(split: boolean): Rect[] {
    const { x, y, width, height } = this.contentBounds;
    if (!split) return [{ x, y, width, height }];
    const half = Math.floor(width / 2);
    return [
      { x, y, width: half, height },
      { x: x + half, y, width: width - half, height },
    ];
  }

  setContentBounds(rect: Rect): void {
    this.contentBounds = rect;
    this.attachActive();
  }

  activateTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    this.state.activeSpaceId = tab.spaceId;
    this.activeTabId = tabId;
    if (this.splitTabId === tabId) this.splitTabId = null;
    tab.lastActiveAt = now();
    this.ensureView(tab);
    this.attachActive();
    this.emit();
  }

  updateTab(tabId: string, patch: TabUpdate): void {
    const tab = this.tab(tabId);
    if (!tab) return;

    if (patch.title !== undefined) tab.title = patch.title.trim() || tab.title;
    if (patch.url !== undefined && patch.url.trim() && patch.url !== tab.url) {
      tab.url = patch.url.trim();
      this.ensureView(tab);
      this.navigate(tab.id, tab.url);
    }
    if ("iconUrl" in patch) tab.iconUrl = patch.iconUrl ?? undefined;
    if ("originalIconUrl" in patch) tab.originalIconUrl = patch.originalIconUrl ?? undefined;
    if (patch.pinnedChanged !== undefined) tab.pinnedChanged = patch.pinnedChanged;
    if (patch.audio !== undefined) tab.audio = patch.audio;
    if (patch.muted !== undefined) tab.muted = patch.muted;
    if (patch.blocked !== undefined) tab.blocked = patch.blocked;
    if (patch.discarded !== undefined) tab.discarded = patch.discarded;
    if (patch.glance !== undefined) tab.glance = patch.glance;
    if ("containerColor" in patch) tab.containerColor = patch.containerColor ?? null;
    if ("sublabel" in patch) tab.sublabel = patch.sublabel ?? null;
    this.emit();
  }

  newTab(opts: { spaceId?: string; url?: string; kind?: Tab["kind"] } = {}): Tab {
    const spaceId = opts.spaceId ?? this.state.activeSpaceId;
    const url = opts.url ?? HOME_URL;
    const tab: Tab = {
      id: id("tab"),
      spaceId,
      kind: opts.kind ?? "today",
      url,
      title: url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      loading: true,
      folderId: null,
      lastActiveAt: now(),
    };
    this.state.tabs.push(tab);
    this.ensureView(tab);
    this.activateTab(tab.id);
    return tab;
  }

  closeTab(tabId: string): void {
    this.state.tabs = this.state.tabs.filter((t) => t.id !== tabId);
    const view = this.views.get(tabId);
    if (view) {
      try {
        this.win.contentView.removeChildView(view);
      } catch {
        /* detached */
      }
      view.webContents.close();
      this.views.delete(tabId);
    }
    if (this.splitTabId === tabId) this.splitTabId = null;
    if (this.activeTabId === tabId) {
      const next = this.state.tabs.find((t) => t.spaceId === this.state.activeSpaceId) ?? null;
      this.activeTabId = next?.id ?? null;
    }
    this.attachActive();
    this.emit();
  }

  private withTab(tabId: string, fn: (wc: Electron.WebContents) => void): void {
    const view = this.views.get(tabId);
    if (view) fn(view.webContents);
  }

  navigate(tabId: string, url: string): void {
    const target = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    this.withTab(tabId, (wc) => void wc.loadURL(target));
  }
  back(tabId: string): void {
    this.withTab(tabId, (wc) => wc.navigationHistory.goBack());
  }
  forward(tabId: string): void {
    this.withTab(tabId, (wc) => wc.navigationHistory.goForward());
  }
  reload(tabId: string): void {
    this.withTab(tabId, (wc) => wc.reload());
  }

  createSpace(name: string, color?: string): Space {
    const space: Space = {
      id: id("sp"),
      name: name.trim() || "New Space",
      color: color ?? SPACE_COLORS[this.state.spaces.length % SPACE_COLORS.length]!,
      icon: "●",
    };
    this.state.spaces.push(space);
    this.state.activeSpaceId = space.id;
    this.emit();
    return space;
  }

  activateSpace(spaceId: string): void {
    if (!this.state.spaces.some((s) => s.id === spaceId)) return;
    this.state.activeSpaceId = spaceId;
    const next = this.state.tabs.find((t) => t.spaceId === spaceId) ?? null;
    if (next) this.activateTab(next.id);
    else {
      this.activeTabId = null;
      this.attachActive();
      this.emit();
    }
  }

  updateSpace(spaceId: string, patch: Partial<Pick<Space, "name" | "color" | "icon">>): void {
    const space = this.state.spaces.find((s) => s.id === spaceId);
    if (!space) return;
    Object.assign(space, patch);
    this.emit();
  }

  deleteSpace(spaceId: string): void {
    if (this.state.spaces.length <= 1) return;
    for (const tab of this.state.tabs.filter((t) => t.spaceId === spaceId)) this.closeTab(tab.id);
    this.state.spaces = this.state.spaces.filter((s) => s.id !== spaceId);
    this.state.folders = this.state.folders.filter((f) => f.spaceId !== spaceId);
    if (this.state.activeSpaceId === spaceId) this.activateSpace(this.state.spaces[0]!.id);
    this.emit();
  }

  pinTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab || tab.kind === "pinned") return;
    tab.kind = "pinned";
    this.ensureView(tab);
    this.emit();
  }

  unpinTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab || tab.kind !== "pinned") return;
    tab.kind = "today";
    tab.folderId = null;
    this.emit();
  }

  createFolder(spaceId: string, name: string): Folder {
    const folder: Folder = { id: id("fd"), spaceId, name: name.trim() || "Folder", collapsed: false };
    this.state.folders.push(folder);
    this.emit();
    return folder;
  }

  renameFolder(folderId: string, name: string): void {
    const folder = this.state.folders.find((f) => f.id === folderId);
    if (folder) {
      folder.name = name.trim() || folder.name;
      this.emit();
    }
  }

  deleteFolder(folderId: string): void {
    this.state.folders = this.state.folders.filter((f) => f.id !== folderId);
    for (const tab of this.state.tabs) if (tab.folderId === folderId) tab.folderId = null;
    this.emit();
  }

  moveToFolder(tabId: string, folderId: string | null): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    tab.folderId = folderId;
    if (folderId) tab.kind = "pinned";
    this.emit();
  }

  reorderTab(tabId: string, beforeId: string | null): void {
    const from = this.state.tabs.findIndex((t) => t.id === tabId);
    if (from < 0) return;
    const [moved] = this.state.tabs.splice(from, 1);
    if (!moved) return;
    const to = beforeId ? this.state.tabs.findIndex((t) => t.id === beforeId) : -1;
    if (to < 0) this.state.tabs.push(moved);
    else this.state.tabs.splice(to, 0, moved);
    this.emit();
  }

  archiveTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    this.state.archive.unshift({
      id: tab.id,
      spaceId: tab.spaceId,
      url: tab.url,
      title: tab.title,
      archivedAt: now(),
    });
    this.state.archive = this.state.archive.slice(0, 200);
    this.closeTab(tabId);
  }

  restoreTab(archiveId: string): void {
    const entry = this.state.archive.find((a) => a.id === archiveId);
    if (!entry) return;
    this.state.archive = this.state.archive.filter((a) => a.id !== archiveId);
    this.newTab({ spaceId: entry.spaceId, url: entry.url });
  }

  clearArchive(): void {
    this.state.archive = [];
    this.emit();
  }

  toggleSplit(tabId: string): void {
    if (this.splitTabId === tabId) this.splitTabId = null;
    else if (this.activeTabId && this.activeTabId !== tabId) {
      this.ensureView(this.tab(tabId)!);
      this.splitTabId = tabId;
    }
    this.attachActive();
    this.emit();
  }

  openPeek(url: string): void {
    const peek = new BrowserWindow({
      width: 720,
      height: 560,
      frame: false,
      roundedCorners: true,
      parent: this.win,
      backgroundColor: "#101214",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    void peek.loadURL(url);
  }

  private autoArchive(): void {
    const cutoff = now() - ARCHIVE_AFTER_MS;
    const stale = this.state.tabs.filter(
      (t) => t.kind === "today" && t.lastActiveAt < cutoff && t.id !== this.activeTabId,
    );
    if (stale.length === 0) return;
    for (const tab of stale) {
      this.state.archive.unshift({
        id: tab.id,
        spaceId: tab.spaceId,
        url: tab.url,
        title: tab.title,
        archivedAt: now(),
      });
      this.closeTab(tab.id);
    }
    this.state.archive = this.state.archive.slice(0, 200);
    this.emit();
  }
}

export type { ArchiveEntry };
