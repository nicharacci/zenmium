import { ElectronBlocker } from "@ghostery/adblocker-electron";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Session } from "electron";
import type { ProtectionState } from "../shared/browser-native";
import { JsonStore } from "./state-store";

type Settings = Record<string, { enabled: boolean; exceptions: string[] }>;
const LISTS = ["https://easylist.to/easylist/easylist.txt", "https://easylist.to/easylist/easyprivacy.txt"];
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/** Owns the session webRequest hooks; no cosmetic preload/global IPC or popup policy. */
export class BrowserBlocking {
  private readonly settingsStore: JsonStore<Settings>;
  private settings: Settings;
  private engine?: ElectronBlocker;
  private loading?: Promise<void>;
  private status: ProtectionState["status"] = "loading";
  private reason?: string;
  private updatedAt?: number;
  private sessions = new Map<Session, string>();
  private counts = new Map<string, number>();
  private disposed = false;
  constructor(private readonly directory: string, private changed: () => void) {
    this.settingsStore = new JsonStore(directory, "content-protection.json");
    const saved = this.settingsStore.read({});
    this.settings = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  }
  private preferences(profileId: string): Settings[string] {
    const saved = this.settings[profileId];
    return { enabled: saved?.enabled !== false, exceptions: Array.isArray(saved?.exceptions) ? saved.exceptions.filter((s): s is string => typeof s === "string") : [] };
  }
  snapshot(profileId: string): ProtectionState {
    const prefs = this.preferences(profileId);
    return { enabled: prefs.enabled, status: prefs.enabled ? this.status : "disabled", blockedCount: this.counts.get(profileId) ?? 0, exceptionOrigins: [...prefs.exceptions], reason: this.reason, updatedAt: this.updatedAt };
  }
  configure(profileId: string, command: { action: "toggle"; enabled: boolean } | { action: "site-exception"; origin: string; allow: boolean }): void {
    const prefs = this.preferences(profileId);
    if (command.action === "toggle") prefs.enabled = command.enabled;
    else {
      const url = new URL(command.origin);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("A web origin is required.");
      prefs.exceptions = prefs.exceptions.filter((origin) => origin !== url.origin);
      if (command.allow) prefs.exceptions.push(url.origin);
    }
    this.settings[profileId] = prefs;
    this.settingsStore.write(this.settings);
    this.changed();
  }
  private async initialize(): Promise<void> {
    const file = join(this.directory, "zenmium", "filter-cache", "ghostery-2.18.2-network.bin");
    try {
      const info = await stat(file);
      if (info.size < 80 * 1024 * 1024) {
        this.engine = ElectronBlocker.deserialize(new Uint8Array(await readFile(file)));
        this.updatedAt = info.mtimeMs;
        this.status = "cached";
      }
    } catch { /* First run or incompatible/corrupt cache. Fetch a verified filter list. */ }
    if (this.engine && Date.now() - (this.updatedAt ?? 0) < MAX_AGE) return;
    try {
      // Native fetch avoids another transport dependency. Public filter-list requests
      // use no browser cookies, credentials, or Workspace session.
      const engine = await ElectronBlocker.fromLists(
        (input: string) => fetch(input, { credentials: "omit", signal: AbortSignal.timeout(15000) }),
        LISTS,
        { loadCosmeticFilters: false, loadExtendedSelectors: false, enableHtmlFiltering: false },
      );
      if (this.disposed) return;
      this.engine = engine;
      this.status = "active";
      this.updatedAt = Date.now();
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, engine.serialize());
      await rename(`${file}.tmp`, file);
    } catch {
      this.status = this.engine ? "cached" : "unavailable";
      this.reason = this.engine ? "Using saved filter lists; the latest lists could not be downloaded." : "Filter lists are unavailable. Network ad/tracker protection is not active.";
    }
  }
  async attach(profileId: string, target: Session): Promise<void> {
    if (this.sessions.has(target)) return;
    this.sessions.set(target, profileId);
    this.loading ??= this.initialize();
    await this.loading;
    if (this.disposed) return;
    const bypass = (details: Electron.OnBeforeRequestListenerDetails | Electron.OnHeadersReceivedListenerDetails): boolean => {
      const prefs = this.preferences(profileId);
      if (!prefs.enabled || !this.engine || !/^https?:/.test(details.url)) return true;
      try { return prefs.exceptions.includes(new URL(details.webContents?.getURL() || details.referrer || details.url).origin); }
      catch { return false; }
    };
    target.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
      if (bypass(details)) { callback({}); return; }
      this.engine!.onBeforeRequest(details, (result) => {
        if (result.cancel || result.redirectURL) {
          this.counts.set(profileId, (this.counts.get(profileId) ?? 0) + 1);
          this.changed();
        }
        callback(result);
      });
    });
    target.webRequest.onHeadersReceived({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
      if (bypass(details)) { callback({}); return; }
      this.engine!.onHeadersReceived(details, callback);
    });
    this.changed();
  }
  dispose(): void {
    this.disposed = true;
    for (const target of this.sessions.keys()) {
      target.webRequest.onBeforeRequest(null);
      target.webRequest.onHeadersReceived(null);
    }
    this.sessions.clear();
  }
}
