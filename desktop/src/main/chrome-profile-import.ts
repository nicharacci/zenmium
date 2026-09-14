import { homedir } from "node:os";
import { promises as fs, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { ImportedBookmark } from "./browser-bookmark-format";

export const CHROME_PROFILE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CHROME_ROOT = join(homedir(), "Library", "Application Support", "Google", "Chrome");

export type ChromeCredentialAvailability = "available" | "protected-by-chrome" | "not-found";

export interface ChromeProfileCandidate {
  id: string;
  directoryName: string;
  name: string;
  emailDomain: string | null;
  avatarInitials: string | null;
  isLastUsed: boolean;
  hasBookmarks: boolean;
  extensionCount: number;
  hasEncryptedCredentials: boolean;
  hasCookies: boolean;
  hasSavedPasswords: boolean;
  credentialAvailability: ChromeCredentialAvailability;
}

/** Internal descriptor. Absolute paths never cross into the renderer. */
export interface ChromeProfileDescriptor extends ChromeProfileCandidate {
  profileDirectory: string;
  bookmarksPath: string;
  extensionsPath: string;
  cookiesPath: string;
  loginDataPath: string;
  localStatePath: string;
}

export interface ChromeExtensionSource {
  id: string;
  version: string;
  name: string;
  sourceDirectory: string;
}

export interface ChromeExtensionCopyResult {
  copiedPath: string;
  source: ChromeExtensionSource;
}

interface JsonRecord { [key: string]: unknown }

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readJson(path: string): JsonRecord | null {
  try { return record(JSON.parse(readFileSync(path, "utf8"))); } catch { return null; }
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

function profileDirectoryIsChild(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const child = relative(resolvedRoot, resolvedCandidate);
  return child.length > 0 && !child.startsWith(`..${sep}`) && child !== ".." && !resolveRootLooksLikeAbsolute(child);
}

function resolveRootLooksLikeAbsolute(value: string): boolean {
  return value.startsWith(sep);
}

function emailDomain(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/@([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,})$/i);
  return match?.[1]?.toLocaleLowerCase() ?? null;
}

function emailInitials(value: string | null): string | null {
  if (!value || !value.includes("@")) return null;
  const local = value.slice(0, value.indexOf("@")).replace(/[^a-z0-9]+/gi, " ").trim();
  if (!local) return null;
  const parts = local.split(/\s+/).filter(Boolean);
  const initials = (parts.length > 1 ? `${parts[0]![0]}${parts.at(-1)![0]}` : local.slice(0, 2))
    .toUpperCase();
  return initials || null;
}

function profileLabel(info: JsonRecord | null, directoryName: string): { name: string; domain: string | null; initials: string | null } {
  const email = [info?.user_name, info?.email, info?.gaia_name].map(stringValue).find((value) => value?.includes("@")) ?? null;
  const domain = emailDomain(email);
  const supplied = stringValue(info?.name) ?? stringValue(info?.gaia_name);
  return { name: supplied ?? (domain ?? directoryName), domain, initials: emailInitials(email) };
}

function countExtensions(path: string): number {
  if (!isDirectory(path)) return 0;
  try {
    return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^[a-p]{32}$/.test(entry.name)).length;
  } catch { return 0; }
}

function publicCandidate(value: ChromeProfileDescriptor): ChromeProfileCandidate {
  const { profileDirectory: _profileDirectory, bookmarksPath: _bookmarksPath, extensionsPath: _extensionsPath, ...candidate } = value;
  return candidate;
}

/** Discover stable Google Chrome profiles without reading credential values. */
export function discoverChromeProfiles(root = DEFAULT_CHROME_ROOT): ChromeProfileDescriptor[] {
  if (!isDirectory(root)) return [];
  const localState = readJson(join(root, "Local State"));
  const cache = record(record(localState?.profile)?.info_cache) ?? {};
  const profileState = record(localState?.profile);
  const lastUsedProfiles = Array.isArray(profileState?.last_active_profiles)
    ? profileState.last_active_profiles as unknown[]
    : [];
  const directoryNames = new Set<string>();
  for (const entry of Object.keys(cache)) if (isDirectory(join(root, entry))) directoryNames.add(entry);
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && (entry.name === "Default" || /^Profile \d+$/.test(entry.name))) directoryNames.add(entry.name);
    }
  } catch { return []; }
  return [...directoryNames].sort((a, b) => a === "Default" ? -1 : b === "Default" ? 1 : a.localeCompare(b, undefined, { numeric: true })).flatMap((directoryName) => {
    const profileDirectory = join(root, directoryName);
    if (!profileDirectoryIsChild(root, profileDirectory)) return [];
    const label = profileLabel(record(cache[directoryName]), directoryName);
    const extensionsPath = join(profileDirectory, "Extensions");
    const cookiesPath = isFile(join(profileDirectory, "Network", "Cookies"))
      ? join(profileDirectory, "Network", "Cookies")
      : join(profileDirectory, "Cookies");
    const loginDataPath = join(profileDirectory, "Login Data");
    const hasCookies = isFile(cookiesPath);
    const hasSavedPasswords = isFile(loginDataPath);
    const descriptor: ChromeProfileDescriptor = {
      id: `chrome:${directoryName}`,
      directoryName,
      name: label.name,
      emailDomain: label.domain,
      avatarInitials: label.initials,
      isLastUsed: lastUsedProfiles.includes(directoryName),
      hasBookmarks: isFile(join(profileDirectory, "Bookmarks")),
      extensionCount: countExtensions(extensionsPath),
      hasEncryptedCredentials: hasSavedPasswords,
      hasCookies,
      hasSavedPasswords,
      credentialAvailability: hasCookies || hasSavedPasswords ? "available" : "not-found",
      profileDirectory,
      bookmarksPath: join(profileDirectory, "Bookmarks"),
      extensionsPath,
      cookiesPath,
      loginDataPath,
      localStatePath: join(root, "Local State"),
    };
    return [descriptor];
  });
}

/** Choose a stable, readable Workspace name from an account domain, then avoid collisions. */
export function chromeSpaceName(profile: Pick<ChromeProfileCandidate, "name" | "emailDomain">, existingNames: Iterable<string>): string {
  const base = profile.emailDomain ?? (profile.name.trim() || "Chrome Profile");
  const readable = base.charAt(0).toLocaleUpperCase() + base.slice(1);
  const existing = new Set([...existingNames].map((value) => value.trim().toLocaleLowerCase()));
  if (!existing.has(readable.toLocaleLowerCase())) return readable;
  let suffix = 2;
  while (existing.has(`${readable} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${readable} ${suffix}`;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/** Convert Chrome's JSON bookmark tree into the browser's sanitized bookmark row format. */
export function parseChromeBookmarks(raw: string): ImportedBookmark[] {
  if (raw.length > 20 * 1024 * 1024) throw new Error("Chrome bookmark import is limited to 20 MB.");
  const parsed = record(JSON.parse(raw));
  if (!parsed) throw new Error("Chrome bookmark data is not a JSON object.");
  const roots = record(parsed.roots);
  if (!roots) return [];
  const rows: ImportedBookmark[] = [];
  let nextKey = 0;
  const walk = (node: JsonRecord, parentKey: number | null, depth: number): void => {
    if (depth > 100 || rows.length >= 20_000) throw new Error("Chrome bookmark import is too large or nested too deeply.");
    const type = stringValue(node.type);
    const title = (stringValue(node.name) ?? "Untitled bookmark").slice(0, 500);
    if (type === "url") {
      const url = safeUrl(node.url);
      if (url) rows.push({ key: nextKey++, parentKey, title, url });
      return;
    }
    const children = Array.isArray(node.children) ? node.children.filter(record) as JsonRecord[] : [];
    if (!children.length) return;
    const key = nextKey++;
    rows.push({ key, parentKey, title: title || "Bookmarks" });
    for (const child of children) walk(child, key, depth + 1);
  };
  for (const rootName of ["bookmark_bar", "other", "synced"]) {
    const root = record(roots[rootName]);
    if (root) walk({ ...root, name: stringValue(root.name) ?? rootName.replace("_", " ") }, null, 0);
  }
  return rows;
}

export async function readChromeBookmarkRows(profile: ChromeProfileDescriptor): Promise<ImportedBookmark[]> {
  if (!profile.hasBookmarks) return [];
  return parseChromeBookmarks(await fs.readFile(profile.bookmarksPath, "utf8"));
}

/** Read only extension manifests and version directories; Chrome profile storage is not copied. */
export async function listChromeExtensionSources(profile: ChromeProfileDescriptor): Promise<ChromeExtensionSource[]> {
  if (!isDirectory(profile.extensionsPath)) return [];
  const output: ChromeExtensionSource[] = [];
  const entries = await fs.readdir(profile.extensionsPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-p]{32}$/.test(entry.name)) continue;
    const extensionRoot = join(profile.extensionsPath, entry.name);
    const versions = (await fs.readdir(extensionRoot, { withFileTypes: true })).filter((version) => version.isDirectory()).map((version) => version.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const version = versions.at(-1);
    if (!version) continue;
    const sourceDirectory = join(extensionRoot, version);
    try {
      const manifest = record(JSON.parse(await fs.readFile(join(sourceDirectory, "manifest.json"), "utf8")));
      const name = stringValue(manifest?.name) ?? entry.name;
      const manifestVersion = stringValue(manifest?.version) ?? version;
      output.push({ id: entry.name, version: manifestVersion, name, sourceDirectory });
    } catch { /* Broken extension manifests are skipped and never copied. */ }
  }
  return output.slice(0, 100);
}

async function copyTree(source: string, target: string): Promise<void> {
  const sourceStat = await fs.lstat(source);
  if (sourceStat.isSymbolicLink()) throw new Error("Chrome extension symlinks are not imported.");
  if (sourceStat.isDirectory()) {
    await fs.mkdir(target, { recursive: true, mode: 0o700 });
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      await copyTree(join(source, entry.name), join(target, entry.name));
    }
    return;
  }
  if (!sourceStat.isFile()) throw new Error("Chrome extension contains an unsupported filesystem entry.");
  await fs.copyFile(source, target);
}

/** Copy an unpacked extension into Zenmium's managed profile directory. */
export async function copyChromeExtension(source: ChromeExtensionSource, destinationRoot: string): Promise<ChromeExtensionCopyResult> {
  const originalStat = await fs.lstat(source.sourceDirectory);
  if (originalStat.isSymbolicLink()) throw new Error("Chrome extension symlinks are not imported.");
  const resolvedSource = await fs.realpath(source.sourceDirectory);
  const resolvedRoot = resolve(destinationRoot);
  const target = join(resolvedRoot, source.id, source.version);
  const targetRelative = relative(resolvedRoot, target);
  if (!targetRelative || targetRelative.startsWith(`..${sep}`) || targetRelative === ".." || targetRelative.startsWith(sep)) throw new Error("Invalid managed extension destination.");
  if (resolvedSource === resolvedRoot || resolvedSource.startsWith(`${resolvedRoot}${sep}`)) throw new Error("Chrome extension source cannot be inside the managed destination.");
  if (!isDirectory(target)) await copyTree(resolvedSource, target);
  return { copiedPath: target, source };
}

export function toChromeProfileCandidate(profile: ChromeProfileDescriptor): ChromeProfileCandidate {
  return publicCandidate(profile);
}
