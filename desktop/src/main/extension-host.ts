/**
 * Zenmium extension host — Chrome extensions loaded **unpacked** into an Electron session.
 *
 * What Electron actually supports today (do not overclaim in product copy, UI, or docs):
 *
 *  1. `session.defaultSession.extensions.loadExtension(path, { allowFileAccess: true })`
 *     loads an **unpacked** extension directory only. There is no supported loader for a
 *     packaged `.crx` / `.crx3` file. `store-install.ts` performs that unpacking itself.
 *  2. Loaded extensions are **not persisted by Electron**. They live for the lifetime of the
 *     session/process only. This module therefore writes its own registry and reloads every
 *     enabled extension on boot (`boot()`).
 *  3. `chrome.webstorePrivate` is **not** implemented. The store's inline "Add to Chrome"
 *     button cannot be relied on; Zenmium routes installs through its own installer instead.
 *  4. `chrome.runtime.connectNative` / `nativeMessaging` is **not** implemented.
 *  5. `chrome.declarativeNetRequest` is **not** implemented.
 *  6. `chrome.storage.sync` is **not** implemented (`storage.local` works). Never show "syncs
 *     across devices" for an extension.
 *  7. Manifest V3 background **service workers are unsupported**. Electron's extension runtime
 *     targets the MV2 background-page model. An MV3 extension may load but its worker will not.
 *  8. There is **no auto-update** from the store. Extensions only change when Zenmium installs
 *     or reloads them.
 *
 * Consequence: the product may say "runs unpacked Chrome extensions" and must fail closed for
 * anything in the list above rather than implying full Chrome parity. See `ZEN-001`…`ZEN-007`
 * in `docs/zenmium/ISSUES.md`.
 *
 * This file owns one thing: the registry and the Electron load/unload lifecycle. It does not
 * own the network download (that is `store-install.ts`) and it does not own IPC wiring.
 */

import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";

import { app, session } from "electron";

/** Seam name used in every `{ ok, seam, reason }` failure. */
export const EXTENSION_SEAM = "extensions" as const;
export type ExtensionSeam = typeof EXTENSION_SEAM;

/** Progress events emitted on the injected EventEmitter. */
export const EXTENSION_PROGRESS_EVENT = "zenmium:extension:progress" as const;
export const EXTENSION_REGISTRY_CHANGED_EVENT = "zenmium:extension:registry-changed" as const;

/** IPC channel names the base lane should re-export from `src/shared/ipc.ts`. */
export const EXTENSION_IPC = {
  list: "extensions:list",
  load: "extensions:load",
  remove: "extensions:remove",
  setEnabled: "extensions:setEnabled",
  progress: EXTENSION_PROGRESS_EVENT,
  registryChanged: EXTENSION_REGISTRY_CHANGED_EVENT,
} as const;

export type ExtensionResult<T> =
  | { ok: true; value: T }
  | { ok: false; seam: ExtensionSeam; reason: string };

/** One row in `userData/zenmium/extensions.json`. */
export interface ExtensionRecord {
  id: string;
  path: string;
  version: string;
  enabled: boolean;
  name: string;
}

export type ExtensionProgressStatus =
  | "loading"
  | "loaded"
  | "disabled"
  | "removed"
  | "error";

export interface ExtensionProgress {
  status: ExtensionProgressStatus;
  id: string;
  name: string;
  reason: string | null;
}

export interface ExtensionBootSummary {
  loaded: string[];
  failed: Array<{ id: string; reason: string }>;
}

/** Structural view of Electron's `session.extensions` API so we do not pin a type version. */
export interface ExtensionSessionLike {
  extensions: {
    loadExtension(
      extensionPath: string,
      options?: { allowFileAccess?: boolean },
    ): Promise<LoadedExtensionLike>;
    removeExtension(extension: LoadedExtensionLike): void;
  };
}

export interface LoadedExtensionLike {
  id: string;
  name: string;
  path: string;
  version?: string;
  manifest?: { version?: string; name?: string };
}

export interface ExtensionHostOptions {
  /** Required. Progress and registry-change events are published here. */
  events: EventEmitter;
  /** Optional override for tests or a partitioned session. Defaults to `session.defaultSession`. */
  session?: ExtensionSessionLike;
  /** Optional explicit registry path. Defaults to `<userData>/zenmium/extensions.json`. */
  registryPath?: string;
}

interface RegistryFile {
  version: 1;
  extensions: Record<string, ExtensionRecord>;
}

const REGISTRY_FILE = "extensions.json";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceRecord(value: unknown): ExtensionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = value["id"];
  const extensionPath = value["path"];
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  if (typeof extensionPath !== "string" || extensionPath.length === 0) {
    return null;
  }
  const version = value["version"];
  const name = value["name"];
  const enabled = value["enabled"];
  return {
    id,
    path: extensionPath,
    version: typeof version === "string" && version.length > 0 ? version : "0.0.0",
    enabled: typeof enabled === "boolean" ? enabled : true,
    name: typeof name === "string" && name.length > 0 ? name : id,
  };
}

function fail<T>(reason: string): ExtensionResult<T> {
  return { ok: false, seam: EXTENSION_SEAM, reason };
}

/**
 * Registry plus Electron load/unload lifecycle for unpacked extensions.
 *
 * Construct once in the main process and share with `store-install.ts`. Call `boot()` after
 * `app.whenReady()` (and after the target session exists) so enabled extensions come back.
 */
export class ExtensionHost {
  private readonly events: EventEmitter;
  private readonly overrideSession: ExtensionSessionLike | undefined;
  private readonly registryFile: string;
  private readonly records = new Map<string, ExtensionRecord>();
  private readonly loaded = new Map<string, LoadedExtensionLike>();
  private initialized = false;

  constructor(options: ExtensionHostOptions) {
    this.events = options.events;
    this.overrideSession = options.session;
    this.registryFile =
      options.registryPath ??
      path.join(app.getPath("userData"), "zenmium", REGISTRY_FILE);
  }

  /** Path of the persisted registry. Exposed for diagnostics; never contains secrets. */
  get registryPath(): string {
    return this.registryFile;
  }

  private get targetSession(): ExtensionSessionLike {
    const target =
      this.overrideSession ?? (session.defaultSession as unknown as ExtensionSessionLike);
    if (
      target === undefined ||
      target === null ||
      typeof target.extensions?.loadExtension !== "function"
    ) {
      throw new Error(
        "Electron session.extensions is unavailable. Zenmium requires an Electron build with the extensions API.",
      );
    }
    return target;
  }

  /** Read and validate the registry. Idempotent. */
  async init(): Promise<ExtensionResult<{ count: number }>> {
    if (this.initialized) {
      return { ok: true, value: { count: this.records.size } };
    }
    try {
      let raw: string | null = null;
      try {
        raw = await fs.readFile(this.registryFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      if (raw !== null && raw.trim().length > 0) {
        this.records.clear();
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Keep the corrupt file for forensics instead of deleting user data.
          const backup = `${this.registryFile}.corrupt-${Date.now()}`;
          await fs.rename(this.registryFile, backup).catch(() => undefined);
          parsed = null;
        }
        if (isRecord(parsed)) {
          const extensions = parsed["extensions"];
          if (isRecord(extensions)) {
            for (const value of Object.values(extensions)) {
              const record = coerceRecord(value);
              if (record !== null) {
                this.records.set(record.id, record);
              }
            }
          }
        }
      }

      this.initialized = true;
      return { ok: true, value: { count: this.records.size } };
    } catch (error) {
      return fail(`Could not read the extension registry: ${errorMessage(error)}`);
    }
  }

  /**
   * Reload every enabled extension. Electron forgets loaded extensions on restart, so this
   * must run once per boot. Failures are reported per-id and never thrown.
   */
  async boot(): Promise<ExtensionResult<ExtensionBootSummary>> {
    const init = await this.init();
    if (!init.ok) {
      return init;
    }
    const loaded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const record of [...this.records.values()]) {
      if (!record.enabled) {
        continue;
      }
      const result = await this.load(record);
      if (result.ok) {
        loaded.push(record.id);
      } else {
        failed.push({ id: record.id, reason: result.reason });
      }
    }
    this.emitRegistryChanged();
    return { ok: true, value: { loaded, failed } };
  }

  /** Snapshot of the registry in insertion order. */
  list(): ExtensionRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  get(id: string): ExtensionRecord | undefined {
    const record = this.records.get(id);
    return record === undefined ? undefined : { ...record };
  }

  /** Ids currently loaded into the Electron session. */
  loadedIds(): string[] {
    return [...this.loaded.keys()];
  }

  /**
   * Register and load an extension from a directory. Upserts the registry row with the
   * canonical id/name/version Electron reports. Unloads any prior copy first.
   */
  async load(input: ExtensionRecord): Promise<ExtensionResult<ExtensionRecord>> {
    const init = await this.init();
    if (!init.ok) {
      return init;
    }
    if (input.id.length === 0) {
      return fail("An extension id is required.");
    }
    if (input.path.length === 0) {
      return fail(`Extension ${input.id} has no path.`);
    }
    if (!path.isAbsolute(input.path)) {
      return fail(`Extension ${input.id} path must be absolute: ${input.path}`);
    }

    try {
      const stat = await fs.stat(input.path);
      if (!stat.isDirectory()) {
        return fail(`Extension path is not a directory: ${input.path}`);
      }
    } catch {
      return fail(`Extension path does not exist: ${input.path}`);
    }

    const previous = this.records.get(input.id);
    await this.unload(input.id);
    this.emitProgress({
      status: "loading",
      id: input.id,
      name: input.name.length > 0 ? input.name : input.id,
      reason: null,
    });

    let loaded: LoadedExtensionLike;
    try {
      loaded = await this.targetSession.extensions.loadExtension(input.path, {
        allowFileAccess: true,
      });
    } catch (error) {
      const reason = `Could not load extension ${input.id}: ${errorMessage(error)}`;
      this.emitProgress({
        status: "error",
        id: input.id,
        name: input.name.length > 0 ? input.name : input.id,
        reason,
      });
      return fail(reason);
    }

    const resolved: ExtensionRecord = {
      id: input.id,
      path: input.path,
      version:
        loaded.version ??
        loaded.manifest?.version ??
        (input.version.length > 0 ? input.version : "0.0.0"),
      enabled: true,
      name:
        loaded.name.length > 0
          ? loaded.name
          : loaded.manifest?.name ?? (input.name.length > 0 ? input.name : input.id),
    };

    this.loaded.set(input.id, loaded);
    this.records.set(input.id, resolved);

    const persisted = await this.persist();
    if (!persisted.ok) {
      // Do not leave memory/disk disagreeing: roll back and unload.
      if (previous === undefined) {
        this.records.delete(input.id);
      } else {
        this.records.set(input.id, previous);
      }
      await this.unload(input.id);
      return fail(persisted.reason);
    }

    this.emitProgress({
      status: "loaded",
      id: resolved.id,
      name: resolved.name,
      reason: null,
    });
    this.emitRegistryChanged();
    return { ok: true, value: { ...resolved } };
  }

  /** Unload (if loaded) and delete the registry row. */
  async remove(id: string): Promise<ExtensionResult<{ id: string; wasRegistered: boolean }>> {
    const init = await this.init();
    if (!init.ok) {
      return init;
    }
    const previous = this.records.get(id);
    if (previous === undefined && !this.loaded.has(id)) {
      return fail(`Unknown extension id: ${id}`);
    }

    await this.unload(id);
    this.records.delete(id);
    const persisted = await this.persist();
    if (!persisted.ok) {
      if (previous !== undefined) {
        this.records.set(id, previous);
      }
      return fail(persisted.reason);
    }

    this.emitProgress({
      status: "removed",
      id,
      name: previous?.name ?? id,
      reason: null,
    });
    this.emitRegistryChanged();
    return { ok: true, value: { id, wasRegistered: previous !== undefined } };
  }

  /** Toggle an extension. Disabling unloads it but keeps the row so boot reloads stay off. */
  async setEnabled(id: string, enabled: boolean): Promise<ExtensionResult<ExtensionRecord>> {
    const init = await this.init();
    if (!init.ok) {
      return init;
    }
    const record = this.records.get(id);
    if (record === undefined) {
      return fail(`Unknown extension id: ${id}`);
    }
    if (record.enabled === enabled) {
      return { ok: true, value: { ...record } };
    }

    if (enabled) {
      return this.load({ ...record, enabled: true });
    }

    await this.unload(id);
    const next: ExtensionRecord = { ...record, enabled: false };
    this.records.set(id, next);
    const persisted = await this.persist();
    if (!persisted.ok) {
      this.records.set(id, record);
      return fail(persisted.reason);
    }

    this.emitProgress({ status: "disabled", id, name: next.name, reason: null });
    this.emitRegistryChanged();
    return { ok: true, value: { ...next } };
  }

  /** Unload everything this host loaded. Does not delete the registry. */
  async dispose(): Promise<void> {
    for (const id of [...this.loaded.keys()]) {
      await this.unload(id);
    }
  }

  private async unload(id: string): Promise<void> {
    const loaded = this.loaded.get(id);
    if (loaded === undefined) {
      return;
    }
    try {
      this.targetSession.extensions.removeExtension(loaded);
    } catch {
      // Already gone or never fully loaded; the map is the source of truth we control.
    }
    this.loaded.delete(id);
  }

  private async persist(): Promise<ExtensionResult<{ count: number }>> {
    try {
      await fs.mkdir(path.dirname(this.registryFile), { recursive: true });
      const data: RegistryFile = {
        version: 1,
        extensions: Object.fromEntries(this.records.entries()),
      };
      const temp = `${this.registryFile}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await fs.rename(temp, this.registryFile);
      return { ok: true, value: { count: this.records.size } };
    } catch (error) {
      return fail(`Could not write the extension registry: ${errorMessage(error)}`);
    }
  }

  private emitProgress(progress: ExtensionProgress): void {
    this.events.emit(EXTENSION_PROGRESS_EVENT, progress);
  }

  private emitRegistryChanged(): void {
    this.events.emit(EXTENSION_REGISTRY_CHANGED_EVENT, this.list());
  }
}
