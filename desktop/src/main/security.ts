import { BrowserWindow, dialog, session, shell, type Session, type WebContents } from "electron";
import type { SitePermission } from "../shared/browser-native";
import { externalApplicationUrl, secureOrigin, webUrl } from "./browser-url";
import { JsonStore } from "./state-store";

const requestable = new Set(["clipboard-read", "clipboard-sanitized-write", "geolocation", "notifications", "media", "fullscreen", "pointerLock"]);

export class BrowserPermissions {
  private readonly store: JsonStore<SitePermission[]>;
  private records: SitePermission[];
  private sessions = new Set<Session>();
  private pending = new Set<number>();
  private onceGrants = new Map<number, Set<string>>();
  private documents = new Map<number, number>();
  private bindDocument(wc: WebContents): void {
    if (this.documents.has(wc.id)) return;
    this.documents.set(wc.id, 0);
    wc.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) {
        this.documents.set(wc.id, (this.documents.get(wc.id) ?? 0) + 1);
        this.onceGrants.delete(wc.id);
      }
    });
    wc.once("destroyed", () => { this.documents.delete(wc.id); this.onceGrants.delete(wc.id); });
  }
  constructor(userDataDir: string, private options: {
    window: () => BrowserWindow | null;
    mayPrompt: (wc: WebContents) => boolean;
    trustedChrome: (wc: WebContents) => boolean;
    changed: () => void;
  }) {
    this.store = new JsonStore(userDataDir, "site-permissions.json");
    const saved = this.store.read([]);
    this.records = Array.isArray(saved) ? saved.filter((r) => r && typeof r.profileId === "string" && secureOrigin(r.origin) === r.origin && typeof r.permission === "string" && ["allow", "deny"].includes(r.decision)) : [];
  }
  list(profileId: string): SitePermission[] {
    return structuredClone(this.records.filter((r) => r.profileId === profileId));
  }
  reset(profileId: string, origin: string, permission?: string): void {
    this.records = this.records.filter((r) => !(r.profileId === profileId && r.origin === origin && (!permission || r.permission === permission)));
    this.store.write(this.records);
    for (const grants of this.onceGrants.values()) for (const key of grants) {
      if (key.startsWith(`${profileId}|${origin}|`) && (!permission || key === `${profileId}|${origin}|${permission}`)) grants.delete(key);
    }
    this.options.changed();
  }
  private decision(profileId: string, origin: string, permission: string): "allow" | "deny" | undefined {
    return this.records.find((r) => r.profileId === profileId && r.origin === origin && r.permission === permission)?.decision;
  }
  attach(profileId: string, target: Session): void {
    if (this.sessions.has(target)) return;
    this.sessions.add(target);
    target.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      if (!wc || wc.isDestroyed()) return false;
      if (this.options.trustedChrome(wc)) return ["clipboard-read", "clipboard-sanitized-write"].includes(permission) && wc.isFocused();
      const origin = secureOrigin(requestingOrigin);
      if (!origin || origin !== secureOrigin(wc.getURL()) || !details.isMainFrame || !this.options.mayPrompt(wc)) return false;
      const key = permission === "media" ? `media:${details.mediaType ?? "unknown"}` : permission;
      return this.decision(profileId, origin, key) === "allow" || this.onceGrants.get(wc.id)?.has(`${profileId}|${origin}|${key}`) === true;
    });
    target.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (this.options.trustedChrome(wc)) {
        callback(["clipboard-read", "clipboard-sanitized-write"].includes(permission) && wc.isFocused());
        return;
      }
      const origin = secureOrigin(details.requestingUrl);
      const window = this.options.window();
      if (!origin || origin !== secureOrigin(wc.getURL()) || !details.isMainFrame || !window || window.isDestroyed() || !this.options.mayPrompt(wc) || !requestable.has(permission)) { callback(false); return; }
      const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
      const keys = permission === "media" ? (mediaTypes?.length ? mediaTypes.map((t) => `media:${t}`) : ["media:audio", "media:video"]) : [permission];
      if (keys.some((key) => this.decision(profileId, origin, key) === "deny")) { callback(false); return; }
      if (keys.every((key) => this.decision(profileId, origin, key) === "allow")) { callback(true); return; }
      if (this.pending.has(wc.id)) { callback(false); return; }
      this.pending.add(wc.id);
      const documentUrl = wc.getURL();
      this.bindDocument(wc);
      const documentRevision = this.documents.get(wc.id);
      void dialog.showMessageBox(window, {
        type: "question", title: "Website permission", message: `${origin} requests ${keys.join(", ")}`,
        detail: "This permission applies only to this website in this Workspace. Background agents cannot approve it.",
        buttons: ["Deny", "Allow once", "Always allow"], defaultId: 0, cancelId: 0, noLink: true,
      }).then(({ response }) => {
        const current = !wc.isDestroyed() && wc.getURL() === documentUrl && this.documents.get(wc.id) === documentRevision && this.options.mayPrompt(wc);
        if (!current) { callback(false); return; }
        if (response === 0 || response === 2) {
          for (const key of keys) {
            this.records = this.records.filter((r) => !(r.profileId === profileId && r.origin === origin && r.permission === key));
            this.records.push({ profileId, origin, permission: key, decision: response === 2 ? "allow" : "deny" });
          }
          this.store.write(this.records);
          this.options.changed();
        }
        if (response === 1) {
          const grants = this.onceGrants.get(wc.id) ?? new Set<string>();
          for (const key of keys) grants.add(`${profileId}|${origin}|${key}`);
          this.onceGrants.set(wc.id, grants);
        }
        callback(response === 1 || response === 2);
      }).catch(() => callback(false)).finally(() => this.pending.delete(wc.id));
    });
    target.setDevicePermissionHandler(() => false);
    target.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  }
  dispose(): void {
    for (const target of this.sessions) installSecurityPolicy(target);
    this.sessions.clear();
  }
}

/** Deny before a Workspace attaches its explicit policy. */
export function installSecurityPolicy(target: Session = session.defaultSession): void {
  target.setPermissionCheckHandler(() => false);
  target.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

/**
 * Window-level hardening. The chrome renderer keeps context isolation and no Node access.
 * New windows never spawn here; https targets become product tabs, everything else goes to the OS.
 */
export function hardenWindow(win: BrowserWindow, onNewTab: (url: string) => void): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    const web = webUrl(url), external = externalApplicationUrl(url);
    if (web) onNewTab(web);
    else if (external) void shell.openExternal(external);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    const web = webUrl(url);
    if (web) onNewTab(web);
  });
}
