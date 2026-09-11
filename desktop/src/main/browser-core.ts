import { EventEmitter } from "node:events";
import { BrowserWindow, WebContentsView } from "electron";
import type { BrowserEvent, BrowserTab, Rect } from "../shared/ipc";

export type Unsubscribe = () => void;

/**
 * Engine-agnostic browser core. The chrome talks to this, never to Chromium directly.
 * A later native engine can implement the same interface.
 */
export interface BrowserCore {
  createTab(url?: string): string;
  closeTab(id: string): void;
  activateTab(id: string): void;
  navigate(id: string, url: string): void;
  back(id: string): void;
  forward(id: string): void;
  reload(id: string): void;
  setContentBounds(rect: Rect): void;
  list(): { tabs: BrowserTab[]; activeId: string | null };
  onEvent(listener: (event: BrowserEvent) => void): Unsubscribe;
}

const HOME = "https://github.com/nicharacci/zenmium";

/** Electron adapter: one WebContentsView per tab, attached to the window's content view. */
export class ElectronBrowserCore implements BrowserCore {
  private readonly win: BrowserWindow;
  private readonly views = new Map<string, WebContentsView>();
  private readonly emitter = new EventEmitter();
  private activeId: string | null = null;
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private seq = 0;

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  onEvent(listener: (event: BrowserEvent) => void): Unsubscribe {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  private emit(event: BrowserEvent): void {
    this.emitter.emit("event", event);
  }

  private snapshot(): BrowserTab[] {
    return [...this.views.entries()].map(([id, view]) => ({
      id,
      url: view.webContents.getURL(),
      title: view.webContents.getTitle() || id,
      loading: view.webContents.isLoading(),
    }));
  }

  private pushTabs(): void {
    this.emit({ type: "tabs", tabs: this.snapshot(), activeId: this.activeId });
  }

  createTab(url: string = HOME): string {
    const id = `tab-${++this.seq}`;
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.views.set(id, view);
    const wc = view.webContents;
    wc.on("did-navigate", (_e, u) => {
      this.emit({ type: "url", id, url: u });
      this.pushTabs();
    });
    wc.on("did-start-loading", () => {
      this.emit({ type: "loading", id, loading: true });
      this.pushTabs();
    });
    wc.on("did-stop-loading", () => {
      this.emit({ type: "loading", id, loading: false });
      this.pushTabs();
    });
    wc.on("page-title-updated", () => this.pushTabs());
    void wc.loadURL(url);
    this.activateTab(id);
    return id;
  }

  private attach(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    this.win.contentView.addChildView(view);
    view.setBounds(this.bounds);
  }

  private detach(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    try {
      this.win.contentView.removeChildView(view);
    } catch {
      // already detached
    }
  }

  activateTab(id: string): void {
    if (!this.views.has(id)) return;
    if (this.activeId && this.activeId !== id) this.detach(this.activeId);
    this.activeId = id;
    this.attach(id);
    this.emit({ type: "active", activeId: id });
    this.pushTabs();
  }

  closeTab(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    this.detach(id);
    view.webContents.close();
    this.views.delete(id);
    if (this.activeId === id) {
      this.activeId = null;
      const next = [...this.views.keys()][0] ?? null;
      if (next) this.activateTab(next);
      else this.emit({ type: "active", activeId: null });
    }
    this.pushTabs();
  }

  navigate(id: string, url: string): void {
    const view = this.views.get(id);
    if (!view) return;
    const target = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    void view.webContents.loadURL(target);
  }

  back(id: string): void {
    this.views.get(id)?.webContents.navigationHistory.goBack();
  }

  forward(id: string): void {
    this.views.get(id)?.webContents.navigationHistory.goForward();
  }

  reload(id: string): void {
    this.views.get(id)?.webContents.reload();
  }

  setContentBounds(rect: Rect): void {
    this.bounds = rect;
    const active = this.activeId ? this.views.get(this.activeId) : undefined;
    active?.setBounds(rect);
  }

  list(): { tabs: BrowserTab[]; activeId: string | null } {
    return { tabs: this.snapshot(), activeId: this.activeId };
  }
}
