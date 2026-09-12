import { join } from "node:path";
import { BrowserWindow, nativeTheme, WebContentsView } from "electron";
import {
  type BrowserOverlayState,
  type BrowserPreferences,
  type BrowserUiState,
  browserLayout,
  CHROME_IPC,
  DEFAULT_PREFERENCES,
  glanceLayout,
  preferencesSchema,
  type SidebarInteraction,
  sidebarRevealed,
} from "../shared/browser-ui";
import { ARC_STATE_EVENT } from "../shared/ipc";
import { ArcCore } from "./arc-core";
import { JsonStore } from "./state-store";

function updateBounds(view: WebContentsView, next: Electron.Rectangle): void {
  const current = view.getBounds();
  if (
    current.x !== next.x ||
    current.y !== next.y ||
    current.width !== next.width ||
    current.height !== next.height
  ) {
    view.setBounds(next);
  }
}

/** Separate native chrome surfaces make menus overlay live Chromium without intercepting page input at rest. */
export class BrowserChrome {
  readonly sidebarView: WebContentsView;
  readonly overlayView: WebContentsView;
  private readonly store: JsonStore<BrowserPreferences | null>;
  private preferencesInitialized = false;
  private ui: BrowserUiState;
  private previousFocus: Electron.WebContents | null = null;
  private unsubscribe: () => void;
  private themeListener: () => void;
  private overlaySession = 0;
  private shrinkTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly win: BrowserWindow,
    private readonly core: ArcCore,
    userDataDir: string
  ) {
    this.store = new JsonStore(userDataDir, "browser-preferences.json");
    const stored = this.store.read(null);
    this.preferencesInitialized = stored !== null;
    const parsed = preferencesSchema.safeParse(stored ?? DEFAULT_PREFERENCES);
    this.ui = {
      dark: true,
      overlay: null,
      preferences: parsed.success ? parsed.data : DEFAULT_PREFERENCES,
      sidebar: { dragging: false, focused: false, hovered: false },
    };
    this.sidebarView = this.createSurface("sidebar");
    this.overlayView = this.createSurface("overlay");
    core.setChromeCallbacks(
      () => this.raise(),
      (wc) => this.bindKeyboard(wc)
    );
    this.bindKeyboard(win.webContents);
    this.unsubscribe = core.onState((state) => {
      this.broadcast(ARC_STATE_EVENT, state);
      this.sync();
    });
    this.themeListener = () => this.sync();
    nativeTheme.on("updated", this.themeListener);
    win.on("resize", () => this.sync());
    win.on("enter-full-screen", () => this.sync());
    win.on("leave-full-screen", () => this.sync());
    this.sync();
  }
  private createSurface(surface: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        // Detached chrome still receives state. Keep its renderer current so
        // reattaching an overlay cannot expose a stale Glance/menu frame.
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(import.meta.dirname, "../preload/index.cjs"),
        sandbox: true,
      },
    });
    view.setBackgroundColor("#00000000");
    this.bindKeyboard(view.webContents);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    const devUrl = process.env["ELECTRON_RENDERER_URL"];
    if (devUrl) {
      const url = new URL(devUrl);
      url.searchParams.set("surface", surface);
      void view.webContents.loadURL(url.href);
    } else
      void view.webContents.loadFile(
        join(import.meta.dirname, "../renderer/index.html"),
        { query: { surface } }
      );
    view.webContents.once("did-finish-load", () => {
      this.broadcast(ARC_STATE_EVENT, this.core.snapshot());
      this.sync();
    });
    return view;
  }
  owns(wc: Electron.WebContents): boolean {
    return [
      this.win.webContents,
      this.sidebarView.webContents,
      this.overlayView.webContents,
    ].includes(wc);
  }
  snapshot(): BrowserUiState {
    return structuredClone(this.ui);
  }
  broadcast(channel: string, payload: unknown): void {
    for (const wc of [
      this.win.webContents,
      this.sidebarView.webContents,
      this.overlayView.webContents,
    ])
      if (!wc.isDestroyed()) wc.send(channel, payload);
  }
  updatePreferences(patch: Partial<BrowserPreferences>): void {
    this.ui.preferences = preferencesSchema.parse({
      ...this.ui.preferences,
      ...patch,
    });
    this.store.write(this.ui.preferences);
    this.preferencesInitialized = true;
    this.sync();
  }
  migratePreferences(patch: Partial<BrowserPreferences>): void {
    if (!this.preferencesInitialized) this.updatePreferences(patch);
  }
  updateSidebar(patch: Partial<SidebarInteraction>): void {
    for (const key of ["hovered", "focused", "dragging"] as const)
      if (typeof patch[key] === "boolean") this.ui.sidebar[key] = patch[key]!;
    this.sync();
  }
  open(overlay: BrowserOverlayState): void {
    if (!this.ui.overlay)
      this.previousFocus = this.sidebarView.webContents.isFocused()
        ? this.sidebarView.webContents
        : (this.core.getActiveWebContents() ?? this.win.webContents);
    this.ui.overlay = { ...overlay, sessionId: ++this.overlaySession };
    this.sync();
    this.overlayView.webContents.focus();
  }
  close(sessionId?: number): void {
    if (sessionId !== undefined && sessionId !== this.ui.overlay?.sessionId)
      return;
    this.ui.overlay = null;
    this.ui.sidebar.focused = false;
    this.ui.sidebar.hovered = false;
    this.sync();
    // Address submission may have selected a new tab. Never restore focus to
    // the detached previous page or to a now-hidden compact sidebar view.
    const wc =
      this.previousFocus === this.sidebarView.webContents &&
      this.ui.preferences.sidebarMode === "expanded"
        ? this.sidebarView.webContents
        : (this.core.getActiveWebContents() ?? this.win.webContents);
    this.previousFocus = null;
    if (wc && !wc.isDestroyed()) {
      wc.focus();
      wc.send(CHROME_IPC.commandEvent, "restore-focus");
    } else this.core.focusActive();
  }
  private sync(finishSidebarExit = false): void {
    if (this.disposed || this.win.isDestroyed()) return;
    this.ui.dark =
      this.ui.preferences.theme === "system"
        ? nativeTheme.shouldUseDarkColors
        : this.ui.preferences.theme === "dark";
    this.core.setSearchEngine(this.ui.preferences.searchEngine);
    const [width, height] = this.win.getContentSize();
    const layout = browserLayout(width, height, this.ui);
    const exiting =
      !sidebarRevealed(this.ui) &&
      layout.sidebar.width < this.sidebarView.getBounds().width;
    if (exiting && !finishSidebarExit) {
      // Keep the native viewport wide until CSS finishes its 150ms exit. An
      // immediate resize clips the animation and makes compact mode snap shut.
      this.shrinkTimer ??= setTimeout(() => {
        this.shrinkTimer = null;
        this.sync(true);
      }, 150);
    } else {
      if (this.shrinkTimer) clearTimeout(this.shrinkTimer);
      this.shrinkTimer = null;
      updateBounds(this.sidebarView, layout.sidebar);
    }
    updateBounds(this.overlayView, { height, width, x: 0, y: 0 });
    this.core.setContentBounds(layout.content);
    this.core.setPeekBounds(glanceLayout(width, height).page);
    this.raise();
    this.win.setWindowButtonVisibility(
      !this.win.isFullScreen() &&
        this.ui.preferences.side === "left" &&
        sidebarRevealed(this.ui) &&
        !this.ui.overlay
    );
    this.broadcast(CHROME_IPC.event, this.snapshot());
  }
  raise(): void {
    if (this.disposed || this.win.isDestroyed()) return;
    const parent = this.win.contentView;
    const peek = this.core.getPeekView();
    const visible = Boolean(this.ui.overlay) || Boolean(peek);
    if (!visible && parent.children.includes(this.overlayView))
      parent.removeChildView(this.overlayView);
    const pages = parent.children.filter(
      (view) =>
        view !== this.sidebarView && view !== this.overlayView && view !== peek
    );
    const order = [
      ...pages,
      this.sidebarView,
      ...(peek && this.ui.overlay ? [peek] : []),
      ...(visible ? [this.overlayView] : []),
      ...(peek && !this.ui.overlay ? [peek] : []),
    ];
    // Reparenting an already-correct NSView interrupts native drags and focus.
    // Change stacking only when opening/closing a real page or overlay requires it.
    order.forEach((view, index) => {
      if (parent.children[index] !== view) parent.addChildView(view, index);
    });
  }
  bindKeyboard(wc: Electron.WebContents): void {
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const meta = input.meta || input.control,
        key = input.key.toLowerCase();
      if (key === "escape") {
        if (this.core.snapshot().glance && !this.ui.overlay) {
          event.preventDefault();
          this.core.closePeek();
        }
        return;
      }
      if (!meta) return;
      // Leave editing keys and menu navigation to the focused renderer/page.
      let command: string | null = null;
      if (key === "t") command = input.shift ? "reopen" : "new-tab";
      else if (key === "l" && !input.shift) command = "address";
      else if (key === "s") command = input.alt ? "reveal-sidebar" : "compact";
      else if (key === "w") command = "close-tab";
      else if (key === "r") command = "reload";
      else if (key === "d") command = "pin";
      else if (key === "y" || (key === "h" && input.shift)) command = "history";
      else if (key === "j") command = "downloads";
      else if (key === ",") command = "settings";
      else if (key === "k") command = "commands";
      else if (key === "[" || (key === "arrowleft" && input.alt))
        command = input.alt ? "previous-space" : "back";
      else if (key === "]" || (key === "arrowright" && input.alt))
        command = input.alt ? "next-space" : "forward";
      else if (/^[1-9]$/.test(key)) command = `tab-${key}`;
      if (command) {
        event.preventDefault();
        try {
          this.command(command);
        } catch (error) {
          this.broadcast(CHROME_IPC.commandEvent, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
  }
  command(command: string): void {
    const state = this.core.snapshot(),
      active = state.tabs.find((t) => t.id === state.activeTabId);
    if (command === "new-tab" && this.ui.overlay?.kind === "new-tab") {
      this.close();
      return;
    }
    if (
      [
        "new-tab",
        "address",
        "history",
        "downloads",
        "settings",
        "commands",
      ].includes(command)
    ) {
      this.open({ kind: command as BrowserOverlayState["kind"] });
      return;
    }
    if (command === "compact") {
      this.updatePreferences({
        sidebarMode:
          this.ui.preferences.sidebarMode === "compact"
            ? "expanded"
            : "compact",
      });
      return;
    }
    if (command === "reveal-sidebar") {
      this.updateSidebar({ focused: !this.ui.sidebar.focused });
      if (this.ui.sidebar.focused) {
        this.sidebarView.webContents.focus();
        this.sidebarView.webContents.send(
          CHROME_IPC.commandEvent,
          "focus-sidebar"
        );
      } else this.core.focusActive();
      return;
    }
    if (command === "collapse") {
      this.updatePreferences({
        sidebarMode:
          this.ui.preferences.sidebarMode === "collapsed"
            ? "expanded"
            : "collapsed",
      });
      return;
    }
    if (command === "reopen" && state.archive[0])
      this.core.restoreTab(state.archive[0].id);
    if (command === "close-tab" && active) this.core.closeTab(active.id);
    if (command === "reload" && active) this.core.reload(active.id);
    if (command === "back" && active) this.core.back(active.id);
    if (command === "forward" && active) this.core.forward(active.id);
    if (command === "pin" && active) {
      if (active.kind === "pinned") this.core.unpinTab(active.id);
      else this.core.pinTab(active.id);
    }
    if (command.startsWith("tab-")) {
      const tabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);
      const index = Number(command.slice(4));
      const tab = tabs[index === 9 ? tabs.length - 1 : index - 1];
      if (tab) this.core.activateTab(tab.id);
    }
    if (command.endsWith("-space")) {
      const index = state.spaces.findIndex((s) => s.id === state.activeSpaceId);
      const delta = command === "next-space" ? 1 : -1;
      const target =
        state.spaces[
          (index + delta + state.spaces.length) % state.spaces.length
        ];
      if (target) this.core.activateSpace(target.id);
    }
  }
  dispose(): void {
    this.disposed = true;
    if (this.shrinkTimer) clearTimeout(this.shrinkTimer);
    this.unsubscribe();
    nativeTheme.off("updated", this.themeListener);
    for (const view of [this.sidebarView, this.overlayView])
      if (!view.webContents.isDestroyed()) view.webContents.close();
  }
}
