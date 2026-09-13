import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  HistoryEntry,
  NewTabOptions,
  Rect,
  Space,
  Tab,
  TabMoveResult,
  TabUpdate,
  WorkspaceAvatar,
} from "../shared/ipc";
import {
  emptyState,
  getPaneTabIds,
  SPACE_COLORS,
} from "../shared/ipc";
import { resolveAddress } from "../shared/navigation";
import { JsonStore } from "./state-store";
import { backupLegacyProfileState, migrateProfileState, newBrowserProfile } from "./profile-state";
import { WorkspaceSessions, type WorkspaceSession } from "./workspace-sessions";

const id = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;
const ARCHIVE_AFTER_MS = 12 * 60 * 60 * 1000;
const ACCOUNT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_IDENTITY_SCRIPT = [
  "(() => {",
  "const selectors = [",
  "'[data-email]', '[data-identifier]', '[data-email-address]',",
  "'[aria-label*=" + JSON.stringify("Google Account") + "]',",
  "'[aria-label*=" + JSON.stringify("Microsoft account") + "]',",
  "'[aria-label*=" + JSON.stringify("@") + "]'",
  "];",
  "for (const selector of selectors) {",
  "  for (const node of document.querySelectorAll(selector)) {",
  "    const value = node.getAttribute('data-email') || node.getAttribute('data-identifier') || node.getAttribute('data-email-address') || node.getAttribute('aria-label') || node.textContent || '';",
  "    const match = value.match(/[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}/i);",
  "    if (match) return match[0];",
  "  }",
  "}",
  "return null;",
  "})()",
].join("\n");
const sameBounds = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function normalizeWorkspaceAvatar(value: unknown): WorkspaceAvatar | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as { initials?: unknown; provider?: unknown };
  const initials = typeof candidate.initials === "string"
    ? candidate.initials.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2)
    : "";
  const providers = new Set<WorkspaceAvatar["provider"]>([
    "google", "microsoft", "apple", "github", "other",
  ]);
  const provider = typeof candidate.provider === "string" && providers.has(candidate.provider as WorkspaceAvatar["provider"])
    ? candidate.provider as WorkspaceAvatar["provider"]
    : undefined;
  return initials && provider ? { initials, provider } : undefined;
}

function accountProvider(url: string): WorkspaceAvatar["provider"] | undefined {
  try {
    const host = new URL(url).hostname.toLocaleLowerCase();
    if (host === "accounts.google.com" || host.endsWith(".google.com") || host === "google.com") return "google";
    if (host === "login.microsoftonline.com" || host.endsWith(".microsoft.com") || host.endsWith(".live.com") || host.endsWith(".outlook.com")) return "microsoft";
    if (host === "appleid.apple.com" || host.endsWith(".icloud.com") || host === "icloud.com") return "apple";
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
  } catch {
    // Navigation URLs are already validated by the browser; an invalid URL simply has no identity provider.
  }
  return undefined;
}

function identityInitials(email: string): string | undefined {
  if (!ACCOUNT_EMAIL_PATTERN.test(email)) return undefined;
  const local = email.slice(0, email.indexOf("@")).replace(/[^a-z0-9]+/gi, " ").trim();
  if (!local) return undefined;
  const parts = local.split(/\s+/).filter(Boolean);
  const initials = (parts.length > 1
    ? `${parts[0]![0]}${parts.at(-1)![0]}`
    : local.slice(0, 2)).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2);
  return initials || undefined;
}

/** Arc owns browser state and Chromium. Renderers send commands and mirror snapshots. */
export class ArcCore {
  private readonly store: JsonStore<ArcState>;
  private readonly views = new Map<string, WebContentsView>();
  private readonly sessions = new WorkspaceSessions();
  private readonly navigationVersions = new Map<string, number>();
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
    const stateFile = join(userDataDir, "zenmium", "state.json");
    const hasLegacyState = existsSync(stateFile);
    // Unlike preferences, corrupt profile metadata must not reset authentication
    // assignments or overwrite its only recoverable copy with a fresh default.
    const raw = hasLegacyState
      ? JSON.parse(readFileSync(stateFile, "utf8")) as ArcState
      : emptyState();
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Browser profile metadata could not be read. Restore its backup before continuing.");
    const migrated = migrateProfileState(this.normalize(raw), hasLegacyState);
    this.state = migrated.state;
    if (migrated.changed) {
      backupLegacyProfileState(userDataDir);
      // Persist identity before any native session can open or a crash can occur.
      this.store.write(this.state);
    }
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
        name: "Workspace 1",
      });
    state.spaces = state.spaces.map((space, index) => {
      const name = typeof space.name === "string" ? space.name.trim() : "";
      return {
        ...space,
        icon:
          typeof space.icon === "string" && space.icon.trim()
            ? space.icon.trim()
            : "◎",
        name: name && name !== "Space" ? name : `Workspace ${index + 1}`,
        avatar: normalizeWorkspaceAvatar(space.avatar),
      };
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
    const snapshot = structuredClone(this.state);
    snapshot.history = snapshot.history?.filter((entry) => entry.spaceId === snapshot.activeSpaceId);
    snapshot.archive = snapshot.archive.filter((entry) => entry.spaceId === snapshot.activeSpaceId);
    return snapshot;
  }
  getProfileId(spaceId: string): string {
    const profileId = this.state.spaces.find((space) => space.id === spaceId)?.profileId;
    if (!profileId) throw new Error("Workspace not found.");
    return profileId;
  }
  getSessionForSpace(spaceId: string): Electron.Session {
    if (this.disposed) throw new Error("Browser is closed.");
    const profileId = this.getProfileId(spaceId);
    const space = this.state.spaces.find((entry) => entry.id === spaceId)!;
    const profile = this.state.profiles?.find((entry) => entry.id === profileId);
    if (!profile) throw new Error("Workspace browser profile not found.");
    return this.sessions.get(space, profile);
  }
  onSessionCreated(listener: (entry: WorkspaceSession) => void | Promise<void>): () => void {
    return this.sessions.onCreated(listener);
  }
  listWorkspaceSessions(): WorkspaceSession[] {
    return this.state.spaces.map((space) => ({
      spaceId: space.id,
      profileId: this.getProfileId(space.id),
      session: this.getSessionForSpace(space.id),
    }));
  }
  getWebContentsForTab(tabId: string): Electron.WebContents | undefined {
    const wc = this.views.get(tabId)?.webContents;
    return wc && !wc.isDestroyed() ? wc : undefined;
  }
  getTabIdForWebContents(webContentsId: number): string | undefined {
    for (const [tabId, view] of this.views) {
      if (!view.webContents.isDestroyed() && view.webContents.id === webContentsId)
        return tabId;
    }
    return undefined;
  }
  /** Trusted control service only. Not exposed by ARC_IPC or TabUpdate. */
  setTabOwner(tabId: string, ownerSessionId: string | undefined): void {
    const tab = this.tab(tabId);
    if (!tab) throw new Error("Tab not found.");
    if (ownerSessionId !== undefined && !/^[a-zA-Z0-9_.:-]{1,160}$/.test(ownerSessionId))
      throw new Error("Invalid agent session identity.");
    if (tab.ownerSessionId && ownerSessionId && tab.ownerSessionId !== ownerSessionId)
      throw new Error("Release existing agent ownership before assigning another session.");
    tab.ownerSessionId = ownerSessionId;
    this.getWebContentsForTab(tabId)?.setBackgroundThrottling(!ownerSessionId);
    this.emit();
  }
  getSpaceIdForWebContents(webContentsId: number): string | undefined {
    if (this.peek && !this.peek.webContents.isDestroyed() && this.peek.webContents.id === webContentsId)
      return this.state.glance?.spaceId;
    for (const [tabId, view] of this.views)
      if (!view.webContents.isDestroyed() && view.webContents.id === webContentsId)
        return this.tab(tabId)?.spaceId;
    return undefined;
  }
  getHistoryForSpace(spaceId: string): HistoryEntry[] {
    this.getProfileId(spaceId);
    return structuredClone((this.state.history ?? []).filter((entry) => entry.spaceId === spaceId));
  }
  private async detectWorkspaceAvatar(tab: Tab, wc: Electron.WebContents): Promise<void> {
    const space = this.state.spaces.find((entry) => entry.id === tab.spaceId);
    const provider = accountProvider(tab.url);
    if (!space || space.avatar || !provider || wc.isDestroyed()) return;
    try {
      // The allow-listed identity page returns an address only to this process. Reduce it to
      // initials immediately; the raw address is never persisted, emitted, logged, or exposed.
      const identity = await wc.executeJavaScript(ACCOUNT_IDENTITY_SCRIPT, true);
      if (typeof identity !== "string") return;
      const initials = identityInitials(identity);
      if (!initials || space.avatar) return;
      space.avatar = { initials, provider };
      this.emit();
    } catch {
      // Provider login DOMs vary and may reject script evaluation; avatar enrichment is best effort.
    }
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
    this.sessions.dispose();
  }
  private tab(tabId: string): Tab | undefined {
    return this.state.tabs.find((t) => t.id === tabId);
  }
  private tabForView(tabId: string, view: WebContentsView): Tab | undefined {
    return !this.disposed && this.views.get(tabId) === view ? this.tab(tabId) : undefined;
  }
  private destroyView(tabId: string): void {
    const view = this.views.get(tabId);
    if (!view) return;
    // Fence old async page events before the same logical tab gets a new profile.
    this.views.delete(tabId);
    this.navigationVersions.delete(tabId);
    if (!this.win.isDestroyed() && this.win.contentView.children.includes(view))
      this.win.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  private loadTab(tab: Tab, view: WebContentsView, url: string): void {
    const version = (this.navigationVersions.get(tab.id) ?? 0) + 1;
    this.navigationVersions.set(tab.id, version);
    const load = () => {
      if (!this.tabForView(tab.id, view) || view.webContents.isDestroyed() || this.navigationVersions.get(tab.id) !== version) return;
      void view.webContents.loadURL(url).catch(() => {});
    };
    const ready = this.sessions.ready(this.getProfileId(tab.spaceId));
    if (!ready) load();
    else {
      tab.loading = true;
      void ready.then(load, () => {
        if (!this.tabForView(tab.id, view) || this.navigationVersions.get(tab.id) !== version) return;
        tab.loading = false;
        tab.error = "This Workspace's browser policy could not initialize. Restart Zenmium to retry.";
        this.emit();
      });
    }
  }
  private ensureView(tab: Tab): WebContentsView {
    const existing = this.views.get(tab.id);
    if (existing) return existing;
    const view = new WebContentsView({
      webPreferences: {
        backgroundThrottling: !tab.ownerSessionId,
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(import.meta.dirname, "../preload/tab.cjs"),
        sandbox: true,
        session: this.getSessionForSpace(tab.spaceId),
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
        !this.tabForView(tab.id, view) ||
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
      if (!this.tabForView(tab.id, view)) return;
      if (tab.ownerSessionId) this.navigate(tab.id, url);
      else this.openPeek(url, { spaceId: tab.spaceId });
    });
    wc.on("context-menu", (_event, params) => {
      const items: Electron.MenuItemConstructorOptions[] = [];
      if (/^https?:\/\//i.test(params.linkURL))
        items.push(
          {
            click: () => this.newTab({ url: params.linkURL, spaceId: tab.spaceId, background: true }),
            label: "Open Link in New Tab",
          },
          {
            click: () => this.openPeek(params.linkURL, { spaceId: tab.spaceId }),
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
      if (!this.tabForView(tab.id, view)) return { action: "deny" };
      if (/^https?:/i.test(url)) {
        if (tab.ownerSessionId) {
          // A task owns one reusable tab. A page popup cannot expand its scope,
          // steal human focus, create Glance, or spawn a second browser window.
          queueMicrotask(() => {
            if (this.tabForView(tab.id, view)) this.navigate(tab.id, url);
          });
        } else if (disposition === "new-window") this.openPeek(url, { spaceId: tab.spaceId });
        else this.newTab({ url, spaceId: tab.spaceId, background: disposition === "background-tab" });
      } else if (!tab.ownerSessionId && /^(mailto|tel):/i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    const refreshNavigation = () => {
      const t = this.tabForView(tab.id, view);
      if (!t || wc.isDestroyed()) return;
      t.canGoBack = wc.navigationHistory.canGoBack();
      t.canGoForward = wc.navigationHistory.canGoForward();
      const url = wc.getURL();
      if (url) t.url = url;
      t.pinnedChanged = Boolean(t.pinnedUrl && t.url !== t.pinnedUrl);
      this.emit();
    };
    wc.on("page-title-updated", () => {
      const t = this.tabForView(tab.id, view);
      if (t) {
        t.title = t.customTitle || wc.getTitle() || t.url;
        this.emit();
      }
    });
    wc.on("page-favicon-updated", (_event, icons) => {
      const t = this.tabForView(tab.id, view);
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
      const t = this.tabForView(tab.id, view);
      if (t) {
        t.loading = true;
        t.error = null;
        t.discarded = false;
        this.emit();
      }
    });
    wc.on("did-stop-loading", () => {
      const t = this.tabForView(tab.id, view);
      if (!t) return;
      t.loading = false;
      t.title = t.customTitle || wc.getTitle() || t.url;
      refreshNavigation();
      void this.detectWorkspaceAvatar(t, wc);
      if (/^https?:/.test(t.url) && !t.error)
        this.state.history = [
          {
            id: id("visit"),
            spaceId: t.spaceId,
            title: t.title,
            url: t.url,
            visitedAt: Date.now(),
          },
          ...(this.state.history ?? []).filter((h) => h.url !== t.url || h.spaceId !== t.spaceId),
        ];
      // One profile cannot evict another profile's history by navigating often.
      let profileVisits = 0;
      this.state.history = this.state.history?.filter((entry) => entry.spaceId !== t.spaceId || ++profileVisits <= 1000);
      this.emit();
    });
    wc.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
      if (code === -3 || !mainFrame) return;
      const t = this.tabForView(tab.id, view);
      if (t) {
        t.loading = false;
        t.error = description;
        this.attachActive();
        this.emit();
      }
    });
    wc.on("media-started-playing", () => {
      const t = this.tabForView(tab.id, view);
      if (t) {
        t.audio = true;
        this.emit();
      }
    });
    wc.on("media-paused", () => {
      const t = this.tabForView(tab.id, view);
      if (t) {
        t.audio = false;
        this.emit();
      }
    });
    wc.on("render-process-gone", () => {
      const t = this.tabForView(tab.id, view);
      if (t) {
        t.error = "This tab stopped responding. Reload to continue.";
        t.loading = false;
        this.attachActive();
        this.emit();
      }
    });
    this.views.set(tab.id, view);
    tab.discarded = false;
    this.loadTab(tab, view, tab.url);
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
    return this.getWebContentsForTab(this.state.activeTabId ?? "");
  }
  private clearSplit(): void {
    this.state.splitTabId = null;
    this.state.splitPrimaryTabId = null;
  }
  private selectTab(tab: Tab): void {
    if (tab.spaceId !== this.state.activeSpaceId) {
      this.closePeek(false);
      this.clearSplit();
    }
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
  newTab(opts: NewTabOptions = {}): Tab {
    if (this.disposed) throw new Error("Browser is closed.");
    if (opts.spaceId && !this.state.spaces.some((space) => space.id === opts.spaceId))
      throw new Error("Workspace not found.");
    const spaceId =
      opts.spaceId && this.state.spaces.some((s) => s.id === opts.spaceId)
        ? opts.spaceId
        : this.state.activeSpaceId;
    const url = resolveAddress(opts.url ?? "", this.searchEngine);
    this.getSessionForSpace(spaceId);
    const tab: Tab = {
      folderId: null,
      id: id("tab"),
      kind: "today",
      lastActiveAt: opts.background || opts.ownerSessionId ? 0 : Date.now(),
      loading: false,
      ownerSessionId: opts.ownerSessionId,
      spaceId,
      title: url === "about:blank" ? "New Tab" : url,
      url,
    };
    this.state.tabs.push(tab);
    if (opts.kind === "pinned") this.pinTab(tab.id);
    if (opts.background || opts.ownerSessionId) {
      // Materialize even about:blank for control clients, without attaching,
      // changing active workspace/tab, or calling focus on any native surface.
      this.ensureView(tab);
      this.emit();
    } else this.activateTab(tab.id);
    return structuredClone(tab);
  }
  /** Main-only OS/file-picker entry. General navigation and agent commands still reject file URLs. */
  openLocalFile(absolutePath: string, spaceId = this.state.activeSpaceId): Tab {
    if (!isAbsolute(absolutePath)) throw new Error("Choose an absolute local file path.");
    const file = realpathSync(absolutePath);
    if (!/\.(html?|xhtml|pdf)$/i.test(extname(file)) || !statSync(file).isFile())
      throw new Error("Choose a local HTML or PDF document.");
    const created = this.newTab({ spaceId });
    const tab = this.tab(created.id)!;
    tab.url = pathToFileURL(file).href;
    tab.title = file.split(/[\\/]/).at(-1) ?? "Local document";
    tab.localFile = true;
    this.ensureView(tab);
    this.attachActive();
    this.emit();
    this.focusActive();
    return structuredClone(tab);
  }
  resetTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab?.pinnedUrl) return;
    if (tab.localFile && tab.pinnedUrl.startsWith("file:")) {
      tab.url = tab.pinnedUrl;
      tab.error = null;
      tab.pinnedChanged = false;
      const view = this.views.get(tab.id);
      if (view) this.loadTab(tab, view, tab.url);
      else this.ensureView(tab);
      this.attachActive();
      this.emit();
    } else this.navigate(tabId, tab.pinnedUrl);
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
    if (tab.kind === "pinned" && !tab.ownerSessionId) {
      tab.url = tab.pinnedUrl ?? tab.url;
      tab.pinnedChanged = false;
      tab.discarded = true;
      tab.audio = false;
      tab.loading = false;
    } else {
      this.state.archive.unshift({
        archivedAt: Date.now(),
        id: tab.id,
        localFile: tab.localFile,
        spaceId: tab.spaceId,
        title: tab.title,
        url: tab.url,
      });
      this.state.archive = this.state.archive.slice(0, 200);
      this.state.tabs = this.state.tabs.filter((t) => t.id !== tabId);
    }
    this.destroyView(tabId);
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
    if (existing) this.loadTab(tab, existing, target);
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
    this.navigationVersions.set(tabId, (this.navigationVersions.get(tabId) ?? 0) + 1);
    this.views.get(tabId)?.webContents.stop();
    const tab = this.tab(tabId);
    if (tab) {
      tab.loading = false;
      this.emit();
    }
  }
  reload(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    tab.error = null;
    const wc = this.views.get(tabId)?.webContents;
    if (wc && this.sessions.ready(this.getProfileId(tab.spaceId))) this.loadTab(tab, this.views.get(tabId)!, tab.url);
    else if (wc) wc.reload();
    else this.ensureView(tab);
    this.attachActive();
    this.emit();
  }
  createSpace(name: string, color?: string, avatar?: WorkspaceAvatar): Space {
    const profile = newBrowserProfile();
    const space: Space = {
      color:
        color ?? SPACE_COLORS[this.state.spaces.length % SPACE_COLORS.length]!,
      icon: "◎",
      id: id("sp"),
      name: name.trim() || `Workspace ${this.state.spaces.length + 1}`,
      profileId: profile.id,
      avatar: normalizeWorkspaceAvatar(avatar),
    };
    this.state.profiles ??= [];
    this.state.profiles.push(profile);
    this.state.spaces.push(space);
    this.activateSpace(space.id);
    return structuredClone(space);
  }
  activateSpace(spaceId: string): void {
    if (!this.state.spaces.some((s) => s.id === spaceId)) return;
    if (spaceId !== this.state.activeSpaceId) this.closePeek(false);
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
    patch: Partial<Pick<Space, "name" | "color" | "icon" | "pinnedCollapsed" | "avatar">>
  ): void {
    const space = this.state.spaces.find((s) => s.id === spaceId);
    if (!space) return;
    if (patch.name?.trim()) space.name = patch.name.trim();
    if (patch.color && /^#[\da-f]{6}$/i.test(patch.color))
      space.color = patch.color;
    if (patch.icon?.trim()) space.icon = patch.icon.trim().slice(0, 16);
    if (typeof patch.pinnedCollapsed === "boolean")
      space.pinnedCollapsed = patch.pinnedCollapsed;
    if (patch.avatar !== undefined)
      space.avatar = normalizeWorkspaceAvatar(patch.avatar);
    this.emit();
  }
  deleteSpace(spaceId: string): void {
    if (this.state.spaces.length <= 1 || !this.state.spaces.some((space) => space.id === spaceId)) return;
    const profileId = this.getProfileId(spaceId);
    if (this.state.glance?.spaceId === spaceId) this.closePeek(false);
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
    this.state.profiles = this.state.profiles?.filter((profile) => profile.id !== profileId);
    this.sessions.forget(profileId);
    this.state.history = this.state.history?.filter((entry) => entry.spaceId !== spaceId);
    this.state.archive = this.state.archive.filter((entry) => entry.spaceId !== spaceId);
    if (this.state.activeSpaceId === spaceId)
      this.activateSpace(this.state.spaces[0]!.id);
    this.emit();
  }
  pinTab(tabId: string): void {
    const tab = this.tab(tabId);
    if (!tab) return;
    if (tab.ownerSessionId) throw new Error("An agent-session tab cannot become an Essential while owned by the agent.");
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
    return structuredClone(folder);
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
      if (tab.ownerSessionId) {
        tab.kind = "today";
        tab.pinnedUrl = undefined;
        tab.pinnedChanged = false;
      } else {
        tab.kind = "pinned";
        tab.pinnedUrl ??= tab.url;
      }
    }
    tab.folderId = folderId;
    this.emit();
  }
  moveTabToSpace(tabId: string, spaceId: string, options: { confirmReload?: boolean } = {}): TabMoveResult {
    const tab = this.tab(tabId);
    if (
      !tab ||
      tab.spaceId === spaceId ||
      !this.state.spaces.some((s) => s.id === spaceId)
    )
      return { status: "unchanged", tabId, spaceId };
    const wasLive = Boolean(this.getWebContentsForTab(tabId));
    if (wasLive && !options.confirmReload)
      return {
        status: "confirmation-required",
        tabId,
        spaceId,
        reason: "Moving to another Workspace reloads this page in its separate browser profile. Unsaved input will be lost; signed-in accounts are not transferred.",
      };
    if (tab.ownerSessionId)
      throw new Error("Release agent ownership before moving its tab to another Workspace.");
    const panes = getPaneTabIds(this.state);
    const survivor =
      panes.length === 2 && panes.includes(tabId)
        ? panes.find((paneId) => paneId !== tabId)
        : undefined;
    this.destroyView(tabId);
    tab.spaceId = spaceId;
    tab.folderId = null;
    tab.url = tab.kind === "pinned" ? (tab.pinnedUrl ?? tab.url) : tab.url;
    tab.audio = false;
    tab.loading = false;
    tab.error = null;
    tab.discarded = true;
    tab.canGoBack = false;
    tab.canGoForward = false;
    tab.pinnedChanged = false;
    // This is a new browsing context, not a live authentication-bearing view
    // moved across spaces. Its stable logical tab ID may still be referenced.
    if (wasLive && tab.url !== "about:blank") this.ensureView(tab);
    if (survivor) {
      this.clearSplit();
      this.activateTab(survivor);
    } else if (this.state.activeTabId === tab.id)
      this.activateSpace(this.state.activeSpaceId);
    this.emit();
    return { status: "moved", tabId, spaceId };
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
    const restored = entry.localFile && entry.url.startsWith("file:")
      ? this.openLocalFile(fileURLToPath(entry.url), entry.spaceId)
      : this.newTab({ spaceId: entry.spaceId, url: entry.url });
    this.updateTab(restored.id, { title: entry.title });
    this.state.archive = this.state.archive.filter((a) => a.id !== archiveId);
    this.emit();
  }
  clearArchive(spaceId = this.state.activeSpaceId): void {
    this.getProfileId(spaceId);
    this.state.archive = this.state.archive.filter((entry) => entry.spaceId !== spaceId);
    this.emit();
  }
  clearHistory(spaceId = this.state.activeSpaceId): void {
    this.getProfileId(spaceId);
    this.state.history = this.state.history?.filter((entry) => entry.spaceId !== spaceId);
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
  openPeek(input: string, options: { spaceId?: string } = {}): void {
    const spaceId = options.spaceId ?? this.state.activeSpaceId;
    const profileSession = this.getSessionForSpace(spaceId);
    // An inactive profile cannot put an overlay over the human's active page.
    if (spaceId !== this.state.activeSpaceId) return;
    const url = resolveAddress(input, this.searchEngine);
    this.closePeek(false);
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: profileSession,
      },
    });
    this.peek = view;
    view.setBorderRadius(10);
    this.keyboardHandler(view.webContents);
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      if (this.peek === view && /^https?:/.test(target)) this.newTab({ url: target, spaceId });
      return { action: "deny" };
    });
    this.state.glance = { title: "Glance", url, spaceId };
    view.webContents.on("page-title-updated", () => {
      if (this.peek === view && this.state.glance) {
        this.state.glance.title = view.webContents.getTitle();
        this.emit();
      }
    });
    view.webContents.on("did-navigate", (_e, target) => {
      if (this.peek === view && this.state.glance) {
        this.state.glance.url = target;
        this.emit();
      }
    });
    const load = () => {
      if (this.peek === view && !view.webContents.isDestroyed())
        void view.webContents.loadURL(url).catch(() => {});
    };
    const ready = this.sessions.ready(this.getProfileId(spaceId));
    if (!ready) load();
    else void ready.then(load, () => {
      if (this.peek === view) this.closePeek(false);
    });
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
  closePeek(restoreFocus = true): void {
    const peek = this.peek;
    this.peek = null;
    this.state.glance = null;
    if (peek) {
      if (!this.win.isDestroyed()) this.win.contentView.removeChildView(peek);
      if (!peek.webContents.isDestroyed()) peek.webContents.close();
    }
    this.emit();
    if (peek && !this.disposed && restoreFocus) this.focusActive();
  }
  promotePeek(): void {
    const url = this.state.glance?.url;
    const spaceId = this.state.glance?.spaceId;
    this.closePeek();
    if (url) this.newTab({ url, spaceId });
  }
  private autoArchive(): void {
    const cutoff = Date.now() - ARCHIVE_AFTER_MS;
    for (const tab of [...this.state.tabs])
      if (
        tab.kind === "today" &&
        !tab.ownerSessionId &&
        tab.lastActiveAt < cutoff &&
        tab.id !== this.state.activeTabId &&
        tab.id !== this.state.splitTabId
      )
        this.closeTab(tab.id);
  }
}
export type { ArchiveEntry };
