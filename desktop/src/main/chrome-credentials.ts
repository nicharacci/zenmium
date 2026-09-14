import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Session } from "electron";
import type { ChromeProfileDescriptor } from "./chrome-profile-import";
import type { SecureStringCodec } from "./service-token";

const execFileAsync = promisify(execFile);
const CHROME_SAFE_STORAGE_SERVICE = "Chrome Safe Storage";
const CHROME_SALT = "saltysalt";
const CHROME_IV = Buffer.alloc(16, 0x20);
const MAX_ROWS = 20_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export type ChromeCredentialStatus =
  | "imported"
  | "partial"
  | "protected-by-chrome"
  | "unavailable"
  | "not-found";

export interface ChromeCredentialImportResult {
  cookiesImported: number;
  cookiesSkipped: number;
  passwordsImported: number;
  passwordsSkipped: number;
  cookieStatus: ChromeCredentialStatus;
  passwordStatus: ChromeCredentialStatus;
  notes: string[];
}

interface ChromeCookieRow {
  host_key?: unknown;
  name?: unknown;
  path?: unknown;
  is_secure?: unknown;
  is_httponly?: unknown;
  samesite?: unknown;
  expires_utc?: unknown;
  encrypted_value_hex?: unknown;
  value?: unknown;
}

interface ChromePasswordRow {
  origin_url?: unknown;
  username_value?: unknown;
  encrypted_password_hex?: unknown;
}

export interface ImportedPassword {
  origin: string;
  username: string;
  password: string;
}

interface StoredPasswordFile {
  version: 1;
  profileId: string;
  credentials: ImportedPassword[];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
}

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function safeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function safeProfileId(profileId: string): string {
  if (!/^profile_[a-zA-Z0-9_-]+$/.test(profileId)) throw new Error("Invalid Workspace profile id.");
  return profileId;
}

/**
 * Chrome on macOS historically derives its v10 values from the user's
 * Keychain item. The command is intentionally main-process-only and its
 * stdout never enters an event, log, renderer payload, or error message.
 */
async function readChromeSafeStoragePassword(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const result = await execFileAsync("/usr/bin/security", [
      "find-generic-password",
      "-s",
      CHROME_SAFE_STORAGE_SERVICE,
      "-w",
    ], { encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 });
    const value = result.stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

export async function deriveChromeLegacyKey(): Promise<Buffer | null> {
  const password = await readChromeSafeStoragePassword();
  if (!password) return null;
  return pbkdf2Sync(password, CHROME_SALT, 1003, 16, "sha1");
}

/** Decrypt Chrome's macOS v10/v11 value without exposing the plaintext outside main. */
export function decryptChromeValue(value: Uint8Array, key: Uint8Array): string | null {
  const bytes = Buffer.from(value);
  if (!bytes.length) return "";
  if (!bytes.subarray(0, 3).equals(Buffer.from("v10")) && !bytes.subarray(0, 3).equals(Buffer.from("v11"))) {
    return bytes.toString("utf8");
  }
  const payload = bytes.subarray(3);
  try {
    // macOS Chrome's legacy safe-storage format is AES-128-CBC with a fixed
    // IV. Keep the branch explicit so a future v20/app-bound value is not
    // silently treated as successfully imported.
    if (key.byteLength === 16) {
      const decipher = createDecipheriv("aes-128-cbc", Buffer.from(key), CHROME_IV);
      return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
    }
    if (key.byteLength === 32 && payload.byteLength > 28) {
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), payload.subarray(0, 12));
      decipher.setAuthTag(payload.subarray(-16));
      return Buffer.concat([decipher.update(payload.subarray(12, -16)), decipher.final()]).toString("utf8");
    }
  } catch {
    return null;
  }
  return null;
}

function decodeHex(value: unknown): Buffer | null {
  const hex = stringValue(value);
  if (!hex || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  try { return Buffer.from(hex, "hex"); } catch { return null; }
}

async function readSqliteJson<T>(database: string, query: string): Promise<T[]> {
  const result = await execFileAsync("/usr/bin/sqlite3", [
    "-readonly",
    "-json",
    database,
    query,
  ], { encoding: "utf8", timeout: 20_000, maxBuffer: MAX_OUTPUT_BYTES });
  const parsed = JSON.parse(result.stdout || "[]") as unknown;
  if (!Array.isArray(parsed)) throw new Error("Chrome data is not a row array.");
  return parsed.slice(0, MAX_ROWS) as T[];
}

function sameSite(value: unknown): "unspecified" | "no_restriction" | "lax" | "strict" | undefined {
  switch (numberValue(value)) {
    case 0: return "no_restriction";
    case 1: return "lax";
    case 2: return "strict";
    default: return "unspecified";
  }
}

function cookieUrl(host: string, path: string, secure: boolean): string | null {
  const normalized = host.replace(/^\.+/, "").trim();
  if (!normalized || normalized.includes("/") || normalized.includes(" ")) return null;
  return `${secure ? "https" : "http"}://${normalized}${path.startsWith("/") ? path : `/${path}`}`;
}

function chromeExpiry(value: unknown): number | undefined {
  const microseconds = numberValue(value);
  if (microseconds <= 0) return undefined;
  const seconds = (microseconds - 11_644_473_600_000_000) / 1_000_000;
  return seconds > 0 && Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * Passwords stay encrypted at rest and are never returned to the renderer.
 * This vault is deliberately separate from browser-control and agent events;
 * a future human autofill surface can consume it without giving agents the
 * imported secret values.
 */
export class ChromeCredentialStore {
  private readonly fileRoot: string;

  private readonly codec?: SecureStringCodec;

  constructor(root: string, codec?: SecureStringCodec) {
    this.codec = codec;
    this.fileRoot = join(root, "chrome-credentials");
  }

  get encryptionAvailable(): boolean { return Boolean(this.codec); }

  private file(profileId: string): string {
    return join(this.fileRoot, `${safeProfileId(profileId)}.bin`);
  }

  private read(profileId: string): ImportedPassword[] {
    if (!this.codec) return [];
    try {
      const raw = JSON.parse(this.codec.decrypt(readFileSync(this.file(profileId)))) as Partial<StoredPasswordFile>;
      if (raw.version !== 1 || raw.profileId !== profileId || !Array.isArray(raw.credentials)) return [];
      return raw.credentials.filter((entry): entry is ImportedPassword => Boolean(entry) &&
        typeof entry === "object" && typeof entry.origin === "string" &&
        typeof entry.username === "string" && typeof entry.password === "string");
    } catch {
      return [];
    }
  }

  upsert(profileId: string, credentials: ImportedPassword[]): number {
    if (!credentials.length) return 0;
    if (!this.codec) throw new Error("Secure credential storage is unavailable on this system.");
    const merged = new Map(this.read(profileId).map((entry) => [`${entry.origin}\u0000${entry.username}`, entry]));
    for (const entry of credentials) merged.set(`${entry.origin}\u0000${entry.username}`, entry);
    const payload: StoredPasswordFile = { version: 1, profileId, credentials: [...merged.values()] };
    const encrypted = this.codec.encrypt(JSON.stringify(payload));
    mkdirSync(this.fileRoot, { recursive: true, mode: 0o700 });
    const temporary = `${this.file(profileId)}.tmp`;
    writeFileSync(temporary, Buffer.from(encrypted), { flag: "w", mode: 0o600 });
    renameSync(temporary, this.file(profileId));
    return credentials.length;
  }
}

const emptyResult = (status: ChromeCredentialStatus): ChromeCredentialImportResult => ({
  cookiesImported: 0,
  cookiesSkipped: 0,
  passwordsImported: 0,
  passwordsSkipped: 0,
  cookieStatus: status,
  passwordStatus: status,
  notes: [],
});

/** Import Chrome cookies and passwords into a specific isolated Workspace. */
export async function importChromeCredentials(
  profile: ChromeProfileDescriptor,
  targetSession: Session,
  targetProfileId: string,
  passwordStore: ChromeCredentialStore,
): Promise<ChromeCredentialImportResult> {
  const hasCookies = profile.hasCookies && profile.cookiesPath;
  const hasPasswords = profile.hasSavedPasswords && profile.loginDataPath;
  if (!hasCookies && !hasPasswords) return emptyResult("not-found");

  const key = await deriveChromeLegacyKey();
  if (!key) {
    const result = emptyResult("protected-by-chrome");
    result.notes.push("Chrome did not expose a legacy decrypt key. App-bound Chrome credentials require Chrome or 1Password approval and were not copied.");
    return result;
  }

  const result = emptyResult("unavailable");
  if (hasCookies) {
    try {
      const rows = await readSqliteJson<ChromeCookieRow>(profile.cookiesPath, `SELECT host_key, name, path, is_secure, is_httponly, samesite, expires_utc, value, hex(encrypted_value) AS encrypted_value_hex FROM cookies LIMIT ${MAX_ROWS}`);
      for (const row of rows) {
        const host = stringValue(row.host_key);
        const name = stringValue(row.name);
        const path = stringValue(row.path) || "/";
        const secure = boolValue(row.is_secure);
        const url = cookieUrl(host, path, secure);
        if (!url || !name) { result.cookiesSkipped += 1; continue; }
        const encrypted = decodeHex(row.encrypted_value_hex);
        const value = encrypted?.length ? decryptChromeValue(encrypted, key) : stringValue(row.value);
        if (value === null) { result.cookiesSkipped += 1; continue; }
        try {
          await targetSession.cookies.set({
            url,
            name,
            value,
            domain: host || undefined,
            path,
            secure,
            httpOnly: boolValue(row.is_httponly),
            sameSite: sameSite(row.samesite),
            expirationDate: chromeExpiry(row.expires_utc),
          });
          result.cookiesImported += 1;
        } catch {
          result.cookiesSkipped += 1;
        }
      }
      result.cookieStatus = result.cookiesSkipped ? (result.cookiesImported ? "partial" : "unavailable") : "imported";
    } catch {
      result.cookieStatus = "unavailable";
      result.notes.push("Chrome cookies could not be read. Quit Chrome and retry the import if the database is busy.");
    }
  } else {
    result.cookieStatus = "not-found";
  }

  if (hasPasswords) {
    try {
      const rows = await readSqliteJson<ChromePasswordRow>(profile.loginDataPath, `SELECT origin_url, username_value, hex(password_value) AS encrypted_password_hex FROM logins LIMIT ${MAX_ROWS}`);
      const credentials: ImportedPassword[] = [];
      for (const row of rows) {
        const origin = safeOrigin(row.origin_url);
        const username = stringValue(row.username_value).slice(0, 2048);
        const encrypted = decodeHex(row.encrypted_password_hex);
        const password = encrypted ? decryptChromeValue(encrypted, key) : null;
        if (!origin || !username || password === null) { result.passwordsSkipped += 1; continue; }
        credentials.push({ origin, username, password });
      }
      if (credentials.length) {
        result.passwordsImported = passwordStore.upsert(targetProfileId, credentials);
      }
      result.passwordStatus = result.passwordsSkipped ? (result.passwordsImported ? "partial" : "unavailable") : "imported";
    } catch (error) {
      result.passwordStatus = error instanceof Error && error.message.includes("Secure credential storage") ? "unavailable" : "unavailable";
      result.notes.push("Chrome passwords could not be imported into encrypted Workspace storage.");
    }
  } else {
    result.passwordStatus = "not-found";
  }

  key.fill(0);
  if (result.cookieStatus === "imported" || result.passwordStatus === "imported") {
    result.notes.push("Imported credential data stayed in the main process; passwords are encrypted with Zenmium safeStorage and cookies are stored by the isolated Workspace session.");
  }
  return result;
}
