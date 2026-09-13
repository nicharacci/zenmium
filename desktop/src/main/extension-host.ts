/** Profile-bound registry and native extension lifecycle. See EXTENSION-AUTH-COMPATIBILITY.md. */
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import electron from "electron";

export const EXTENSION_SEAM = "extensions" as const;
export type ExtensionSeam = typeof EXTENSION_SEAM;
export const EXTENSION_PROGRESS_EVENT = "zenmium:extension:progress" as const;
export const EXTENSION_REGISTRY_CHANGED_EVENT = "zenmium:extension:registry-changed" as const;
export const EXTENSION_IPC = {
  list: "extensions:list", load: "extensions:load", remove: "extensions:remove",
  setEnabled: "extensions:setEnabled", progress: EXTENSION_PROGRESS_EVENT,
  registryChanged: EXTENSION_REGISTRY_CHANGED_EVENT,
} as const;
export type ExtensionResult<T> = { ok: true; value: T } |
  { ok: false; seam: ExtensionSeam; reason: string };
export interface ExtensionRecord {
  id: string; path: string; version: string; enabled: boolean; name: string;
  allowFileAccess?: boolean; source?: "unpacked" | "store";
}
export type ExtensionProgressStatus = "loading" | "loaded" | "disabled" | "removed" | "error";
export interface ExtensionProgress {
  status: ExtensionProgressStatus; id: string; name: string; reason: string | null;
  profileId?: string;
}
export interface ExtensionBootSummary { loaded: string[]; failed: Array<{ id: string; reason: string }> }
export interface LoadedExtensionLike {
  id: string; name: string; path: string; version?: string;
  manifest?: {
    version?: string; name?: string; permissions?: string[];
    action?: { default_popup?: string }; browser_action?: { default_popup?: string };
  };
}
export interface ExtensionApiLike {
  loadExtension(extensionPath: string, options?: { allowFileAccess?: boolean }): Promise<LoadedExtensionLike>;
  removeExtension(extensionId: string): void;
  getExtension?(extensionId: string): LoadedExtensionLike | null;
}
/** Electron 35 uses Session directly; newer runtimes may expose Session.extensions. */
export interface ExtensionSessionLike {
  extensions?: ExtensionApiLike;
  loadExtension?: ExtensionApiLike["loadExtension"];
  removeExtension?: ExtensionApiLike["removeExtension"];
  getExtension?: ExtensionApiLike["getExtension"];
  isPersistent?(): boolean;
}
export interface ExtensionAction { extensionId: string; profileId: string; url: string }
export interface ExtensionHostOptions {
  events: EventEmitter;
  session?: ExtensionSessionLike;
  registryPath?: string;
  profileId?: string;
  /** Must mount the popup in the supplied Session; never the browser chrome's session. */
  openPopup?: (action: ExtensionAction, session: ExtensionSessionLike) => Promise<void>;
}
const fail = <T>(reason: string): ExtensionResult<T> => ({ ok: false, seam: EXTENSION_SEAM, reason });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function coerceRecord(value: unknown): ExtensionRecord | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      typeof value.path !== "string" || !path.isAbsolute(value.path)) return null;
  return {
    id: value.id, path: value.path, enabled: value.enabled !== false,
    name: typeof value.name === "string" ? value.name : value.id,
    version: typeof value.version === "string" ? value.version : "0.0.0",
    allowFileAccess: value.allowFileAccess === true,
    source: value.source === "store" ? "store" : "unpacked",
  };
}
export class ExtensionHost {
  readonly profileId: string;
  private readonly options: ExtensionHostOptions;
  private readonly registryFile: string;
  private readonly records = new Map<string, ExtensionRecord>();
  private readonly loaded = new Map<string, LoadedExtensionLike>();
  private initialized = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(options: ExtensionHostOptions) {
    this.options = options;
    this.profileId = options.profileId ?? "legacy-default";
    if (this.profileId !== "legacy-default" && (!options.session || !options.registryPath))
      throw new Error("Profile extensions require an explicit session and registryPath.");
    this.registryFile = options.registryPath ?? path.join(electron.app.getPath("userData"), "zenmium", "extensions.json");
  }
  get registryPath(): string { return this.registryFile; }
  get managedRoot(): string { return path.join(path.dirname(this.registryFile), "extensions"); }
  private get targetSession(): ExtensionSessionLike {
    const target = this.options.session ?? electron.session.defaultSession;
    if (target.isPersistent?.() === false) throw new Error("Extensions require a persistent profile.");
    return target;
  }
  private get api(): ExtensionApiLike {
    const target = this.targetSession;
    const api = target.extensions ?? target;
    if (typeof api.loadExtension !== "function" || typeof api.removeExtension !== "function")
      throw new Error("The installed Electron runtime has no supported extension loader.");
    return api as ExtensionApiLike;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation, operation);
    this.pending = next.catch(() => undefined);
    return next;
  }
  init(): Promise<ExtensionResult<{ count: number }>> { return this.serial(() => this.readRegistry()); }
  private async readRegistry(): Promise<ExtensionResult<{ count: number }>> {
    if (this.initialized) return { ok: true, value: { count: this.records.size } };
    try {
      let raw: string;
      try { raw = await fs.readFile(this.registryFile, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        this.initialized = true;
        return { ok: true, value: { count: 0 } };
      }
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { return fail("The extension registry is malformed; it was preserved without modification."); }
      if (!isRecord(parsed) || ![1, 2].includes(Number(parsed.version)) || !isRecord(parsed.extensions))
        return fail("The extension registry format is unsupported; it was preserved without modification.");
      if (parsed.version === 2 && parsed.profileId !== this.profileId)
        return fail("The extension registry belongs to a different profile.");
      const validated = Object.values(parsed.extensions).map(coerceRecord);
      if (validated.some(record => !record)) return fail("An extension registry entry is invalid; no entries were changed.");
      for (const record of validated) if (record) this.records.set(record.id, record);
      this.initialized = true;
      return { ok: true, value: { count: this.records.size } };
    } catch { return fail("Could not read the extension registry."); }
  }
  boot(): Promise<ExtensionResult<ExtensionBootSummary>> {
    return this.serial(async () => {
      const init = await this.readRegistry(); if (!init.ok) return init;
      const loaded: string[] = [], failed: Array<{ id: string; reason: string }> = [];
      for (const record of [...this.records.values()]) {
        if (!record.enabled) continue;
        const result = await this.loadInternal(record);
        if (result.ok) loaded.push(result.value.id);
        else failed.push({ id: record.id, reason: result.reason });
      }
      return { ok: true, value: { loaded, failed } };
    });
  }
  list(): ExtensionRecord[] { return [...this.records.values()].map(record => ({ ...record })); }
  get(id: string): ExtensionRecord | undefined {
    const value = this.records.get(id);
    return value ? { ...value } : undefined;
  }
  loadedIds(): string[] { return [...this.loaded.keys()]; }
  /** Legacy UI IDs may be paths. Only the native loader supplies the canonical identity. */
  load(input: ExtensionRecord): Promise<ExtensionResult<ExtensionRecord>> {
    return this.serial(() => this.loadInternal(input));
  }
  private async loadInternal(input: ExtensionRecord): Promise<ExtensionResult<ExtensionRecord>> {
    const init = await this.readRegistry(); if (!init.ok) return init;
    if (!input.path || !path.isAbsolute(input.path)) return fail("An absolute unpacked extension directory is required.");
    let directory: string;
    try {
      directory = await fs.realpath(input.path);
      if (!(await fs.stat(directory)).isDirectory()) return fail("Extension path is not a directory.");
      const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
      if (!isRecord(manifest) || typeof manifest.name !== "string" || typeof manifest.version !== "string")
        return fail("The extension manifest needs a name and version.");
    } catch { return fail("The unpacked extension or manifest cannot be read."); }
    const before = new Map(this.records);
    const previous = [...this.records.values()].filter(record => record.id === input.id || record.path === directory);
    try {
      for (const record of previous) this.unload(record.id);
      this.emitProgress({ status: "loading", id: input.id, name: input.name, reason: null });
      const loaded = await this.api.loadExtension(directory, { allowFileAccess: input.allowFileAccess === true });
      if (!/^[a-p]{32}$/.test(loaded.id) || (input.source === "store" && loaded.id !== input.id)) {
        this.api.removeExtension(loaded.id);
        throw new Error("invalid-runtime-identity");
      }
      const conflict = this.records.get(loaded.id);
      if (conflict && !previous.includes(conflict) && conflict.path !== directory) {
        this.api.removeExtension(loaded.id);
        throw new Error("duplicate-extension-identity");
      }
      for (const record of previous) this.records.delete(record.id);
      const resolved: ExtensionRecord = {
        id: loaded.id, path: directory, name: loaded.name || input.name,
        version: loaded.version ?? loaded.manifest?.version ?? input.version,
        enabled: true, allowFileAccess: input.allowFileAccess === true, source: input.source ?? "unpacked",
      };
      this.loaded.set(loaded.id, loaded);
      this.records.set(loaded.id, resolved);
      try { await this.persist(); }
      catch { this.unload(loaded.id); throw new Error("registry-write-failed"); }
      this.emitProgress({ status: "loaded", id: resolved.id, name: resolved.name, reason: null });
      this.emitRegistryChanged();
      return { ok: true, value: { ...resolved } };
    } catch {
      this.records.clear();
      for (const [id, record] of before) this.records.set(id, record);
      for (const record of previous) await this.restoreRuntime(record);
      const reason = "Extension loading or persistence failed; check runtime support, identity, and directory access.";
      this.emitProgress({ status: "error", id: input.id, name: input.name, reason });
      return fail(reason);
    }
  }
  private async restoreRuntime(record: ExtensionRecord): Promise<void> {
    if (!record.enabled || this.loaded.has(record.id)) return;
    try {
      const restored = await this.api.loadExtension(record.path, { allowFileAccess: record.allowFileAccess === true });
      if (restored.id === record.id) this.loaded.set(restored.id, restored);
      else this.api.removeExtension(restored.id);
    } catch { /* Remains visibly unloaded; never report a false success. */ }
  }
  remove(id: string): Promise<ExtensionResult<{ id: string; wasRegistered: boolean }>> {
    return this.serial(async () => {
      const init = await this.readRegistry(); if (!init.ok) return init;
      const record = this.records.get(id); if (!record) return fail("Unknown extension id.");
      try { this.unload(id); this.records.delete(id); await this.persist(); }
      catch { this.records.set(id, record); await this.restoreRuntime(record); return fail("Extension removal failed; registry entry was preserved."); }
      this.emitProgress({ status: "removed", id, name: record.name, reason: null });
      this.emitRegistryChanged();
      return { ok: true, value: { id, wasRegistered: true } };
    });
  }
  setEnabled(id: string, enabled: boolean): Promise<ExtensionResult<ExtensionRecord>> {
    return this.serial(async () => {
      const init = await this.readRegistry(); if (!init.ok) return init;
      const record = this.records.get(id); if (!record) return fail("Unknown extension id.");
      if (enabled && !this.loaded.has(id)) return this.loadInternal(record);
      if (record.enabled === enabled) return { ok: true, value: { ...record } };
      const next = { ...record, enabled };
      try { this.unload(id); this.records.set(id, next); await this.persist(); }
      catch { this.records.set(id, record); await this.restoreRuntime(record); return fail("Could not persist the extension state."); }
      this.emitProgress({ status: "disabled", id, name: next.name, reason: null });
      this.emitRegistryChanged();
      return { ok: true, value: { ...next } };
    });
  }
  actionPopup(id: string): ExtensionResult<ExtensionAction> {
    const loaded = this.loaded.get(id);
    if (!loaded) return fail("The extension is not loaded in this profile.");
    const popup = loaded.manifest?.action?.default_popup ?? loaded.manifest?.browser_action?.default_popup;
    if (!popup) return fail("This extension has no declared popup; action-click dispatch is unavailable.");
    try {
      const url = new URL(popup, "chrome-extension://" + id + "/");
      if (url.protocol !== "chrome-extension:" || url.hostname !== id || url.username || url.password)
        return fail("The extension popup must belong to the loaded extension.");
      return { ok: true, value: { extensionId: id, profileId: this.profileId, url: url.href } };
    } catch { return fail("The extension popup URL is invalid."); }
  }
  openAction(id: string): Promise<ExtensionResult<ExtensionAction>> {
    return this.serial(async () => {
      const action = this.actionPopup(id); if (!action.ok) return action;
      if (!this.options.openPopup) return fail("The native extension popup surface is not connected.");
      try { await this.options.openPopup(action.value, this.targetSession); return action; }
      catch { return fail("The native extension popup could not be opened."); }
    });
  }
  dispose(): Promise<void> {
    return this.serial(async () => { for (const id of [...this.loaded.keys()]) this.unload(id); });
  }
  private unload(id: string): void {
    if (!this.loaded.has(id)) return;
    this.api.removeExtension(id);
    this.loaded.delete(id);
  }
  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.registryFile), { recursive: true, mode: 0o700 });
    const temp = this.registryFile + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temp, JSON.stringify({ version: 2, profileId: this.profileId,
        extensions: Object.fromEntries(this.records) }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      await fs.rename(temp, this.registryFile);
    } finally { await fs.unlink(temp).catch(() => undefined); }
  }
  private emitProgress(progress: ExtensionProgress): void {
    this.options.events.emit(EXTENSION_PROGRESS_EVENT, { ...progress, profileId: this.profileId });
  }
  private emitRegistryChanged(): void {
    this.options.events.emit(EXTENSION_REGISTRY_CHANGED_EVENT, this.list(), { profileId: this.profileId });
  }
}
