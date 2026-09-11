/**
 * Zenmium wrapped extension install.
 *
 * This module mirrors the download half of a normal browser store install. It does **not**
 * impersonate the store, does **not** claim the store installed anything, and does **not**
 * implement store account, rating, or update APIs. The store's own install button is not
 * trusted because Electron does not implement `chrome.webstorePrivate` (see
 * `extension-host.ts`). Zenmium instead resolves the same public update endpoint the browser
 * uses, unpacks the CRX itself, and loads the result as an unpacked extension.
 *
 * Pipeline (`start`):
 *   1. resolving   parse a store detail URL or a bare 32-char id `[a-p]{32}`.
 *   2. downloading stream the CRX from the public update endpoint and report byte progress.
 *   3. verifying   check the CRX magic/version/header bounds; derive the declared extension id
 *                  and refuse to continue if it does not match the requested id. This is the
 *                  ZEN-004 check that stops an attacker-controlled fallback package from being
 *                  installed under the wrong id.
 *   4. extracting  reject unsafe zip entries (absolute paths, `..`), unpack into a staging
 *                  directory, then swap it into `userData/zenmium/extensions/<id>/`.
 *   5. installing  hand the directory to `ExtensionHost.load`, which reloads it into the
 *                  Electron session and persists the registry row.
 *   6. done/error
 *
 * Security posture:
 *   - The id is validated before any network call.
 *   - The user-supplied URL is only *parsed* for an id; it is never fetched. The update
 *     endpoint origin is hard-coded to `https://clients2.google.com`.
 *   - The id declared by the CRX header and the id derived from the embedded public key must
 *     both match the requested id (when each is present).
 *   - Zip paths are validated before extraction; the payload's CRC is enforced by adm-zip.
 *   - We do **not** verify the store's signature chain in v1 because no Google root is pinned;
 *     the doc and UI must not claim cryptographic provenance, only that the id matched.
 *
 * Electron install limitations (unpacked only, MV3 worker unsupported, no auto-update) are
 * documented in `extension-host.ts` and `docs/zenmium/STORE-INSTALL.md`.
 */

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";

import AdmZip from "adm-zip";
import { app } from "electron";
import { request } from "undici";
import { z } from "zod";

import { ExtensionHost, type ExtensionRecord } from "./extension-host";

/** Seam name used in failures. The renderer contract also carries `stage`. */
export const STORE_INSTALL_SEAM = "store-install" as const;
export type StoreInstallSeam = typeof STORE_INSTALL_SEAM;

/** Progress events emitted on the injected EventEmitter. */
export const STORE_INSTALL_PROGRESS_EVENT = "zenmium:store-install:progress" as const;

/** IPC channel names the base lane should re-export from `src/shared/ipc.ts`. */
export const STORE_INSTALL_IPC = {
  start: "extensions:store-install:start",
  cancel: "extensions:store-install:cancel",
  progress: STORE_INSTALL_PROGRESS_EVENT,
} as const;

export const STORE_INSTALL_STAGES = [
  "idle",
  "resolving",
  "downloading",
  "verifying",
  "extracting",
  "installing",
  "done",
  "error",
] as const;

export type StoreInstallStage = (typeof STORE_INSTALL_STAGES)[number];

export interface StoreInstallProgress {
  stage: StoreInstallStage;
  id: string | null;
  name: string | null;
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  reason: string | null;
}

export type StoreInstallResult =
  | { ok: true; id: string; path: string; version: string; name: string }
  | { ok: false; seam: StoreInstallSeam; stage: StoreInstallStage; reason: string };

/** Zod schema for a Chrome extension id. Exported so `src/shared/ipc.ts` can reuse it. */
export const extensionIdSchema = z
  .string()
  .trim()
  .regex(/^[a-p]{32}$/, "An extension id is 32 characters from a to p.");

/** Accepts a bare id or a store detail URL. */
export const extensionIdOrUrlSchema = z.string().trim().min(1, "An extension id or URL is required.");

/** Public update endpoint origin. Hard-coded; never taken from user input. */
export const CRX_UPDATE_ORIGIN = "https://clients2.google.com";

/** Hosts we are willing to *parse* an id out of. We never fetch the supplied URL. */
const ALLOWED_STORE_HOSTS = new Set(["chromewebstore.google.com", "chrome.google.com"]);

/** Fallback Chromium version when `process.versions.chrome` is unavailable. */
const FALLBACK_CHROME_VERSION = "120.0.0.0";

const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_CRX_BYTES = 256 * 1024 * 1024;

export interface StoreInstallerOptions {
  /** Required. Owns the unpacked registry + Electron session lifecycle. */
  host: ExtensionHost;
  /** Required. Install progress is published here. */
  events: EventEmitter;
  /** Managed extensions root. Defaults to `<userData>/zenmium/extensions`. */
  extensionsRoot?: string;
  /** Chromium version sent to the update endpoint. Defaults to `process.versions.chrome`. */
  chromeVersion?: string;
}

/**
 * Parse a bare extension id or a Chrome Web Store detail URL into an id.
 *
 * Accepts:
 *   - `abcdefghijklmnopabcdefghijklmnop`
 *   - `https://chromewebstore.google.com/detail/<slug>/<id>`
 *   - `https://chrome.google.com/webstore/detail/<slug>/<id>`
 *   - a URL carrying `?id=<id>`
 *
 * Returns `null` for anything else, including other origins. The supplied URL is only parsed;
 * it is never requested.
 */
export function parseExtensionId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (extensionIdSchema.safeParse(trimmed).success) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") {
    return null;
  }
  if (!ALLOWED_STORE_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const idPattern = /[a-p]{32}/g;
  const byQuery = url.searchParams.get("id");
  if (byQuery !== null && extensionIdSchema.safeParse(byQuery).success) {
    return byQuery;
  }
  const fromPath = url.pathname.match(idPattern);
  if (fromPath !== null && fromPath.length > 0) {
    return fromPath[fromPath.length - 1] ?? null;
  }
  return null;
}

/** Build the public CRX update URL. `id` must already be validated. */
export function buildCrxUpdateUrl(id: string, chromeVersion: string): string {
  return (
    `${CRX_UPDATE_ORIGIN}/service/update2/crx` +
    `?response=redirect` +
    `&prodversion=${encodeURIComponent(chromeVersion)}` +
    `&acceptformat=crx2,crx3` +
    `&x=id%3D${encodeURIComponent(id)}%26uc`
  );
}

class StoreInstallError extends Error {
  readonly stage: StoreInstallStage;

  constructor(stage: StoreInstallStage, message: string) {
    super(message);
    this.name = "StoreInstallError";
    this.stage = stage;
  }
}

export interface ParsedCrx {
  version: number;
  /** Zip payload bytes (the part a CRX wraps). */
  payload: Buffer;
  /**
   * Extension id declared inside the CRX header. Empty string when the header carries no
   * `signed_header_data.crx_id`; callers must treat empty as "unverified" and fail closed.
   */
  declaredId: string;
  /** Id derived from the embedded public key. Empty string when no key was found. */
  derivedId: string;
}

function fail(stage: StoreInstallStage, reason: string): StoreInstallResult {
  return { ok: false, seam: STORE_INSTALL_SEAM, stage, reason };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Map 32 hex characters (0-f) to the extension-id alphabet (a-p). */
function hexToExtensionId(hex: string): string {
  let out = "";
  for (const character of hex) {
    const value = Number.parseInt(character, 16);
    if (!Number.isInteger(value) || value < 0 || value > 15) {
      return "";
    }
    out += String.fromCharCode(97 + value);
  }
  return out;
}

function readVarint(buffer: Buffer, offset: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  let position = offset;
  while (position < buffer.length) {
    const byte = buffer[position] ?? 0;
    value += (byte & 0x7f) * 2 ** shift;
    position += 1;
    if ((byte & 0x80) === 0) {
      return { value, offset: position };
    }
    shift += 7;
    if (shift > 35) {
      throw new Error("Malformed varint in CRX header.");
    }
  }
  throw new Error("Truncated varint in CRX header.");
}

/** Read one length-delimited field from a protobuf message. */
function readBytesField(
  message: Buffer,
  wantedField: number,
): { value: Buffer | null; offset: number } {
  let offset = 0;
  while (offset < message.length) {
    const key = readVarint(message, offset);
    offset = key.offset;
    const field = Math.floor(key.value / 8);
    const wire = key.value & 0x7;
    if (wire === 0) {
      const skipped = readVarint(message, offset);
      offset = skipped.offset;
      continue;
    }
    if (wire !== 2) {
      if (wire === 5) {
        offset += 4;
        continue;
      }
      if (wire === 1) {
        offset += 8;
        continue;
      }
      return { value: null, offset: message.length };
    }
    const length = readVarint(message, offset);
    offset = length.offset;
    const end = offset + length.value;
    if (end > message.length) {
      return { value: null, offset: message.length };
    }
    if (field === wantedField) {
      return { value: Buffer.from(message.subarray(offset, end)), offset: end };
    }
    offset = end;
  }
  return { value: null, offset: message.length };
}

/**
 * CrxFileHeader protobuf:
 *   field 2: sha256_with_rsa (AsymmetricKeyProof)  -> field 1 public_key
 *   field 3: sha256_with_ecdsa (AsymmetricKeyProof)
 *   field 10000: signed_header_data (SignedData)   -> field 1 crx_id (16 bytes)
 */
function extractPublicKey(header: Buffer): Buffer | null {
  let offset = 0;
  while (offset < header.length) {
    const key = readVarint(header, offset);
    offset = key.offset;
    const field = Math.floor(key.value / 8);
    const wire = key.value & 0x7;
    if (wire !== 2) {
      if (wire === 0) {
        const skipped = readVarint(header, offset);
        offset = skipped.offset;
        continue;
      }
      break;
    }
    const length = readVarint(header, offset);
    offset = length.offset;
    const end = offset + length.value;
    if (end > header.length) {
      break;
    }
    if (field === 2 || field === 3) {
      const proof = header.subarray(offset, end);
      const publicKey = readBytesField(proof, 1).value;
      if (publicKey !== null && publicKey.length > 0) {
        return publicKey;
      }
    }
    offset = end;
  }
  return null;
}

function extractDeclaredCrxId(header: Buffer): Buffer | null {
  let offset = 0;
  while (offset < header.length) {
    const key = readVarint(header, offset);
    offset = key.offset;
    const field = Math.floor(key.value / 8);
    const wire = key.value & 0x7;
    if (wire !== 2) {
      if (wire === 0) {
        const skipped = readVarint(header, offset);
        offset = skipped.offset;
        continue;
      }
      break;
    }
    const length = readVarint(header, offset);
    offset = length.offset;
    const end = offset + length.value;
    if (end > header.length) {
      break;
    }
    if (field === 10000) {
      const signedHeaderData = header.subarray(offset, end);
      const crxId = readBytesField(signedHeaderData, 1).value;
      if (crxId !== null && crxId.length === 16) {
        return crxId;
      }
    }
    offset = end;
  }
  return null;
}

/**
 * Parse a CRX2 or CRX3 container and read the declared/derived extension ids.
 * Throws `StoreInstallError("verifying", …)` for any structural problem.
 */
export function parseCrx(bytes: Buffer): ParsedCrx {
  if (bytes.length < 16 || bytes.subarray(0, 4).toString("ascii") !== "Cr24") {
    throw new StoreInstallError(
      "verifying",
      "The downloaded file is not a CRX package (missing Cr24 magic).",
    );
  }
  const version = bytes.readUInt32LE(4);
  if (version !== 2 && version !== 3) {
    throw new StoreInstallError(
      "verifying",
      `Unsupported CRX container version ${version}.`,
    );
  }

  if (version === 3) {
    if (bytes.length < 12) {
      throw new StoreInstallError("verifying", "The CRX3 header is truncated.");
    }
    const headerLength = bytes.readUInt32LE(8);
    const headerEnd = 12 + headerLength;
    if (headerLength <= 0 || headerEnd > bytes.length) {
      throw new StoreInstallError("verifying", "The CRX3 header length is invalid.");
    }
    const header = bytes.subarray(12, headerEnd);
    const payload = bytes.subarray(headerEnd);
    if (payload.length === 0) {
      throw new StoreInstallError("verifying", "The CRX3 package has an empty payload.");
    }
    const publicKey = extractPublicKey(header);
    const declared = extractDeclaredCrxId(header);
    return {
      version,
      payload,
      declaredId:
        declared === null ? "" : hexToExtensionId(declared.toString("hex")),
      derivedId:
        publicKey === null
          ? ""
          : hexToExtensionId(
              createHash("sha256").update(publicKey).digest().subarray(0, 16).toString("hex"),
            ),
    };
  }

  // CRX2: [magic 4][version 4][pubkey len 4][sig len 4][pubkey][sig][zip]
  if (bytes.length < 16) {
    throw new StoreInstallError("verifying", "The CRX2 header is truncated.");
  }
  const publicKeyLength = bytes.readUInt32LE(8);
  const signatureLength = bytes.readUInt32LE(12);
  const headerEnd = 16 + publicKeyLength + signatureLength;
  if (headerEnd > bytes.length) {
    throw new StoreInstallError("verifying", "The CRX2 header length is invalid.");
  }
  const publicKey = bytes.subarray(16, 16 + publicKeyLength);
  const payload = bytes.subarray(headerEnd);
  if (payload.length === 0) {
    throw new StoreInstallError("verifying", "The CRX2 package has an empty payload.");
  }
  return {
    version,
    payload,
    declaredId: "",
    derivedId:
      publicKeyLength > 0
        ? hexToExtensionId(
            createHash("sha256").update(publicKey).digest().subarray(0, 16).toString("hex"),
          )
        : "",
  };
}

/** Reject zip entries that could escape the extraction root. */
function assertSafeEntry(entryName: string): void {
  const normalized = entryName.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new StoreInstallError("extracting", `Refused absolute path in package: ${entryName}`);
  }
  if (normalized.split("/").includes("..")) {
    throw new StoreInstallError("extracting", `Refused path traversal in package: ${entryName}`);
  }
  if (normalized.includes("\0")) {
    throw new StoreInstallError("extracting", "Refused a null byte in a package path.");
  }
}

interface ManifestSummary {
  name: string;
  version: string;
}

async function readManifestSummary(directory: string, fallbackId: string): Promise<ManifestSummary> {
  try {
    const raw = await fs.readFile(path.join(directory, "manifest.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { name: fallbackId, version: "0.0.0" };
    }
    const manifest = parsed as Record<string, unknown>;
    const name = manifest["name"];
    const version = manifest["version"];
    return {
      name: typeof name === "string" && name.length > 0 ? name : fallbackId,
      version: typeof version === "string" && version.length > 0 ? version : "0.0.0",
    };
  } catch {
    return { name: fallbackId, version: "0.0.0" };
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "AbortError")
  );
}

function abortError(): Error {
  const error = new Error("The install was cancelled.");
  error.name = "AbortError";
  return error;
}

function truncate(value: string, max = 240): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

/**
 * Runs the wrapped install pipeline. One instance may start installs sequentially; calling
 * `start` again cancels the in-flight download.
 */
export class StoreInstaller {
  private readonly host: ExtensionHost;
  private readonly events: EventEmitter;
  private readonly extensionsRoot: string;
  private readonly chromeVersion: string;
  private active: AbortController | null = null;

  constructor(options: StoreInstallerOptions) {
    this.host = options.host;
    this.events = options.events;
    this.extensionsRoot =
      options.extensionsRoot ?? path.join(app.getPath("userData"), "zenmium", "extensions");
    this.chromeVersion = options.chromeVersion ?? process.versions.chrome ?? FALLBACK_CHROME_VERSION;
  }

  /** Abort an in-flight install, if any. Safe to call when idle. */
  cancel(): void {
    this.active?.abort();
    this.active = null;
  }

  async start(idOrUrl: string): Promise<StoreInstallResult> {
    this.cancel();
    const controller = new AbortController();
    this.active = controller;

    const id = parseExtensionId(idOrUrl);
    if (id === null) {
      return this.emitFailure(
        "resolving",
        "Enter a 32-character extension id or a Chrome Web Store detail URL.",
        null,
      );
    }

    try {
      this.emit({
        stage: "resolving",
        id,
        name: null,
        receivedBytes: 0,
        totalBytes: null,
        percent: null,
        reason: null,
      });

      const updateUrl = buildCrxUpdateUrl(id, this.chromeVersion);
      const downloaded = await this.download(updateUrl, id, controller.signal);

      this.emit({
        stage: "verifying",
        id,
        name: null,
        receivedBytes: downloaded.bytes.byteLength,
        totalBytes: downloaded.bytes.byteLength,
        percent: 100,
        reason: null,
      });
      const parsed = parseCrx(downloaded.bytes);

      // The requested id must match what the package declares. Fail closed on any mismatch
      // or when the header did not carry enough to verify (ZEN-004).
      const declared = parsed.declaredId;
      const derived = parsed.derivedId;
      if (declared === "" && derived === "") {
        return this.emitFailure(
          "verifying",
          "The package header did not declare an extension id, so it could not be verified.",
          id,
        );
      }
      if (declared !== "" && declared !== id) {
        return this.emitFailure(
          "verifying",
          `The package declares extension id ${declared}, which does not match ${id}.`,
          id,
        );
      }
      if (derived !== "" && derived !== id) {
        return this.emitFailure(
          "verifying",
          `The public key in the package resolves to ${derived}, which does not match ${id}.`,
          id,
        );
      }
      if (declared !== "" && derived !== "" && declared !== derived) {
        return this.emitFailure(
          "verifying",
          "The package declares one id and its public key resolves to another.",
          id,
        );
      }

      const target = path.join(this.extensionsRoot, id);
      await this.extract(parsed.payload, target, controller.signal);

      this.emit({
        stage: "installing",
        id,
        name: null,
        receivedBytes: downloaded.bytes.byteLength,
        totalBytes: downloaded.bytes.byteLength,
        percent: 100,
        reason: null,
      });
      const manifest = await readManifestSummary(target, id);
      const record: ExtensionRecord = {
        id,
        path: target,
        version: manifest.version,
        enabled: true,
        name: manifest.name,
      };
      const loaded = await this.host.load(record);
      if (!loaded.ok) {
        return this.emitFailure("installing", loaded.reason, id);
      }

      this.emit({
        stage: "done",
        id,
        name: loaded.value.name,
        receivedBytes: downloaded.bytes.byteLength,
        totalBytes: downloaded.bytes.byteLength,
        percent: 100,
        reason: null,
      });
      return {
        ok: true,
        id,
        path: target,
        version: loaded.value.version,
        name: loaded.value.name,
      };
    } catch (error) {
      if (isAbortError(error)) {
        return this.emitFailure("error", "The install was cancelled.", id);
      }
      if (error instanceof StoreInstallError) {
        return this.emitFailure(error.stage, error.message, id);
      }
      return this.emitFailure("error", errorMessage(error), id);
    } finally {
      if (this.active === controller) {
        this.active = null;
      }
    }
  }

  private async download(
    url: string,
    id: string,
    signal: AbortSignal,
  ): Promise<{ bytes: Buffer }> {
    this.emit({
      stage: "downloading",
      id,
      name: null,
      receivedBytes: 0,
      totalBytes: null,
      percent: 0,
      reason: null,
    });

    const response = await request(url, {
      method: "GET",
      maxRedirections: 10,
      signal,
      headersTimeout: DOWNLOAD_TIMEOUT_MS,
      bodyTimeout: DOWNLOAD_TIMEOUT_MS,
      headers: {
        accept: "application/x-chrome-extension, application/octet-stream, */*",
        "user-agent": `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ` +
          `(KHTML, like Gecko) Chrome/${this.chromeVersion} Safari/537.36`,
      },
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      await response.body.dump();
      throw new StoreInstallError(
        "downloading",
        `The update endpoint returned HTTP ${response.statusCode}.`,
      );
    }

    const contentLength = response.headers["content-length"];
    const declaredLength =
      typeof contentLength === "string" ? Number.parseInt(contentLength, 10) : Number.NaN;
    const totalBytes =
      Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : null;

    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let lastEmit = 0;

    for await (const chunk of response.body) {
      if (signal.aborted) {
        throw abortError();
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      receivedBytes += buffer.byteLength;
      if (receivedBytes > MAX_CRX_BYTES) {
        throw new StoreInstallError(
          "downloading",
          `The package is larger than the ${Math.round(MAX_CRX_BYTES / (1024 * 1024))} MB limit.`,
        );
      }
      chunks.push(buffer);

      const now = Date.now();
      if (now - lastEmit >= 100) {
        lastEmit = now;
        this.emit({
          stage: "downloading",
          id,
          name: null,
          receivedBytes,
          totalBytes,
          percent:
            totalBytes === null
              ? null
              : Math.min(100, Math.round((receivedBytes / totalBytes) * 100)),
          reason: null,
        });
      }
    }

    const bytes = Buffer.concat(chunks);
    if (bytes.byteLength === 0) {
      throw new StoreInstallError("downloading", "The update endpoint returned an empty response.");
    }

    this.emit({
      stage: "downloading",
      id,
      name: null,
      receivedBytes: bytes.byteLength,
      totalBytes: totalBytes ?? bytes.byteLength,
      percent: 100,
      reason: null,
    });

    return {
      bytes,
    };
  }

  private async extract(payload: Buffer, target: string, signal: AbortSignal): Promise<void> {
    let zip: AdmZip;
    try {
      zip = new AdmZip(payload);
    } catch (error) {
      throw new StoreInstallError(
        "extracting",
        `The package payload is not a readable zip: ${errorMessage(error)}`,
      );
    }

    const entries = zip.getEntries();
    if (entries.length === 0) {
      throw new StoreInstallError("extracting", "The package payload contained no files.");
    }
    for (const entry of entries) {
      assertSafeEntry(entry.entryName);
    }

    const parent = path.dirname(target);
    await fs.mkdir(parent, { recursive: true });
    const staging = `${target}.staging-${process.pid}-${Date.now()}`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });

    try {
      await new Promise<void>((resolve, reject) => {
        zip.extractAllToAsync(staging, true, false, (error) => {
          if (error !== null && error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      if (signal.aborted) {
        throw abortError();
      }

      // A real extension always has a manifest. Refuse to swap in a package without one.
      await fs.access(path.join(staging, "manifest.json"));

      const backup = `${target}.previous-${process.pid}-${Date.now()}`;
      let hadPrevious = false;
      try {
        await fs.rename(target, backup);
        hadPrevious = true;
      } catch {
        hadPrevious = false;
      }
      try {
        await fs.rename(staging, target);
      } catch (error) {
        if (hadPrevious) {
          await fs.rename(backup, target).catch(() => undefined);
        }
        throw error;
      }
      if (hadPrevious) {
        await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
      }
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private emit(progress: StoreInstallProgress): void {
    this.events.emit(STORE_INSTALL_PROGRESS_EVENT, progress);
  }

  private emitFailure(
    stage: StoreInstallStage,
    reason: string,
    id: string | null,
  ): StoreInstallResult {
    this.emit({
      stage: "error",
      id,
      name: null,
      receivedBytes: 0,
      totalBytes: null,
      percent: null,
      reason,
    });
    return fail(stage, reason);
  }
}
