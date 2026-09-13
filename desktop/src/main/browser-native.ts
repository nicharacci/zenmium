import { readFile, stat, writeFile } from "node:fs/promises";
import { app, BrowserWindow, dialog } from "electron";
import {
  type BookmarkCommand, type NativeBrowserState, NATIVE_IPC,
  type UtilityCommand, onboardingCommandSchema, permissionCommandSchema, protectionCommandSchema,
} from "../shared/browser-native";
import type { ArcCore } from "./arc-core";
import { BrowserBookmarks } from "./browser-bookmarks";
import { exportBookmarks } from "./browser-bookmark-format";
import type { BrowserBlocking } from "./browser-blocking";
import type { BrowserPermissions } from "./security";
import { JsonStore } from "./state-store";

const safeFilename = (name: string): string => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100) || "Zennium page";

export class NativeBrowserServices {
  readonly bookmarks: BrowserBookmarks;
  private readonly onboardingStore: JsonStore<NativeBrowserState["onboarding"]>;
  private onboarding: NativeBrowserState["onboarding"];
  private findTargets = new Set<number>();
  constructor(private readonly window: BrowserWindow, private readonly core: ArcCore, directory: string,
    private readonly permissions: BrowserPermissions, private readonly blocking: BrowserBlocking,
    private readonly broadcast: (channel: string, payload: unknown) => void,
    private readonly takeover: (tabId: string) => void,
  ) {
    this.bookmarks = new BrowserBookmarks(directory);
    this.onboardingStore = new JsonStore(directory, "onboarding.json");
    const saved = this.onboardingStore.read({ version: 1, completed: false, agentEnabled: false });
    this.onboarding = { version: 1, completed: saved?.version === 1 && saved.completed === true, agentEnabled: saved?.agentEnabled === true };
  }
  private profile(): string { return this.core.getProfileId(this.core.snapshot().activeSpaceId); }
  snapshot(): NativeBrowserState {
    const profileId = this.profile();
    return {
      bookmarks: this.bookmarks.list(profileId), permissions: this.permissions.list(profileId),
      onboarding: { ...this.onboarding },
      defaultBrowser: { http: app.isDefaultProtocolClient("http"), https: app.isDefaultProtocolClient("https"), packaged: app.isPackaged },
      zoomFactor: this.core.getActiveWebContents()?.getZoomFactor() ?? 1,
      protection: this.blocking.snapshot(profileId),
    };
  }
  changed(): void { if (!this.window.isDestroyed()) this.broadcast(NATIVE_IPC.event, this.snapshot()); }
  isAgentEnabled(): boolean { return this.onboarding.agentEnabled; }
  needsOnboarding(): boolean { return !this.onboarding.completed; }
  updateOnboarding(payload: unknown): NativeBrowserState {
    const change = onboardingCommandSchema.parse(payload);
    this.onboarding = { ...this.onboarding, agentEnabled: change.agentEnabled, completed: change.action === "complete" || this.onboarding.completed };
    this.onboardingStore.write(this.onboarding);
    this.changed();
    return this.snapshot();
  }
  permission(payload: unknown): NativeBrowserState {
    const change = permissionCommandSchema.parse(payload);
    this.permissions.reset(this.profile(), change.origin, change.permission);
    return this.snapshot();
  }
  protection(payload: unknown): NativeBrowserState {
    this.blocking.configure(this.profile(), protectionCommandSchema.parse(payload));
    return this.snapshot();
  }
  async bookmark(command: BookmarkCommand): Promise<NativeBrowserState> {
    const state = this.core.snapshot(), profileId = this.core.getProfileId(state.activeSpaceId);
    if (command.action === "add" || command.action === "folder") this.bookmarks.add(profileId, command);
    else if (command.action === "update") this.bookmarks.update(profileId, command.id, command);
    else if (command.action === "remove") this.bookmarks.remove(profileId, command.id);
    else if (command.action === "open") {
      const bookmark = this.bookmarks.list(profileId).find((b) => b.id === command.id);
      if (!bookmark?.url) throw new Error("Bookmark not found.");
      this.core.newTab({ spaceId: state.activeSpaceId, url: bookmark.url, background: command.background });
    } else if (command.action === "add-current") {
      const active = state.tabs.find((t) => t.id === state.activeTabId);
      if (!active || !/^https?:/.test(active.url)) throw new Error("Open a web page to bookmark it.");
      if (!this.bookmarks.list(profileId).some((b) => b.url === active.url)) this.bookmarks.add(profileId, { title: active.title || active.url, url: active.url });
    } else if (command.action === "import") {
      const choice = await dialog.showOpenDialog(this.window, { title: "Import bookmarks into this Workspace", properties: ["openFile"], filters: [{ name: "Bookmark HTML", extensions: ["html", "htm"] }] });
      const path = choice.filePaths[0];
      if (!choice.canceled && path) {
        if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error("Bookmark import is limited to 10 MB.");
        this.bookmarks.import(profileId, await readFile(path, "utf8"));
      }
    } else if (command.action === "export") {
      const rows = this.bookmarks.list(profileId);
      const choice = await dialog.showSaveDialog(this.window, { title: "Export Workspace bookmarks", defaultPath: "Zennium bookmarks.html", filters: [{ name: "Bookmark HTML", extensions: ["html"] }] });
      if (!choice.canceled && choice.filePath) await writeFile(choice.filePath, exportBookmarks(rows), "utf8");
    }
    this.changed();
    return this.snapshot();
  }
  async utility(command: UtilityCommand): Promise<unknown> {
    if (command.action === "set-default-browser") {
      if (!app.isPackaged) throw new Error("Install the packaged Zenmium app in Applications before selecting it as your default browser.");
      app.setAsDefaultProtocolClient("http");
      app.setAsDefaultProtocolClient("https");
      this.changed();
      return this.snapshot();
    }
    const tabId = this.core.snapshot().activeTabId;
    const wc = tabId ? this.core.getWebContentsForTab(tabId) : undefined;
    if (!wc || wc.isDestroyed() || !tabId) throw new Error("Open a page first.");
    this.takeover(tabId);
    if (command.action === "find") {
      if (!this.findTargets.has(wc.id)) {
        this.findTargets.add(wc.id);
        wc.on("found-in-page", (_event, result) => this.broadcast(NATIVE_IPC.findResult, { ...result, tabId }));
      }
      return { requestId: wc.findInPage(command.query, { forward: command.forward ?? true, findNext: command.findNext ?? false, matchCase: command.matchCase ?? false }), tabId };
    }
    if (command.action === "stop-find") wc.stopFindInPage("keepSelection");
    else if (command.action.startsWith("zoom-")) {
      const next = command.action === "zoom-reset" ? 1 : wc.getZoomFactor() + (command.action === "zoom-in" ? 0.1 : -0.1);
      wc.setZoomFactor(Math.min(5, Math.max(0.25, Math.round(next * 100) / 100)));
    } else if (command.action === "print") {
      await new Promise<void>((resolve, reject) => wc.print({ silent: false, printBackground: true }, (success, reason) => success ? resolve() : reject(new Error(reason || "Printing was cancelled."))));
    } else if (command.action === "save-pdf" || command.action === "save-page") {
      const pdf = command.action === "save-pdf";
      const choice = await dialog.showSaveDialog(this.window, { title: pdf ? "Save page as PDF" : "Save web page", defaultPath: `${safeFilename(wc.getTitle())}.${pdf ? "pdf" : "mhtml"}`, filters: [{ name: pdf ? "PDF" : "Web archive", extensions: [pdf ? "pdf" : "mhtml"] }] });
      if (!choice.canceled && choice.filePath && !wc.isDestroyed()) {
        if (pdf) await writeFile(choice.filePath, await wc.printToPDF({ printBackground: true }));
        else await wc.savePage(choice.filePath, "MHTML");
      }
    }
    this.changed();
    return this.snapshot();
  }
}
