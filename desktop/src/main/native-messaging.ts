/**
 * Native stdio transport, NOT a chrome.runtime API polyfill. A trusted extension-runtime
 * adapter must resolve the real sender and route only to that sender. No HTTP/MCP exposure.
 * Electron's stock nativeMessaging capability is not assumed by this module.
 */
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;
const HOST_NAME = /^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;
const EXTENSION_ID = /^[a-p]{32}$/;
export type NativeMessagingFailure =
  | "untrusted-browser" | "unauthorized-sender" | "host-not-allowed"
  | "invalid-host" | "untrusted-host" | "cancelled" | "host-failed" | "invalid-message";
export class NativeMessagingError extends Error {
  readonly code: NativeMessagingFailure;
  constructor(code: NativeMessagingFailure) { super(code); this.code = code; }
}
export interface NativeExtensionSender {
  profileId: string;
  extensionId: string;
  /** Actual frame/worker URL resolved in the main process, never accepted from request JSON. */
  url: string;
  permissions: readonly string[];
}
export interface NativeHostPolicy {
  name: string;
  manifestPath: string;
  /** Explicit trusted installation path; cannot be changed by the manifest. */
  executablePath: string;
  /** A designated requirement including vendor identity, not just any valid signature. */
  signatureRequirement: string;
}
export interface NativeMessagingBrokerOptions<SenderHandle> {
  allowedHosts: readonly NativeHostPolicy[];
  resolveSender(handle: SenderHandle): Promise<NativeExtensionSender | null>;
  isAuthorized(sender: NativeExtensionSender, host: string): boolean | Promise<boolean>;
  isBrowserTrusted(): Promise<boolean>;
  verifyHost?: (executable: string, requirement: string) => Promise<boolean>;
  launch?: typeof spawn;
}
/** Only reports validation state; codesign stdout/stderr and certificate data never escape. */
export async function verifyMacCodeSignature(executable: string, requirement: string): Promise<boolean> {
  if (process.platform !== "darwin" || !path.isAbsolute(executable) || !requirement) return false;
  try {
    await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--all-architectures", "-R", requirement, executable],
      { timeout: 10_000, maxBuffer: 64 * 1024 });
    return true;
  } catch { return false; }
}
/** Incremental framing handles split headers, split UTF-8, and multiple messages per read. */
export class NativeMessageDecoder {
  private pending = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    const messages: unknown[] = [];
    this.pending = Buffer.concat([this.pending, chunk]);
    let offset = 0;
    while (this.pending.length - offset >= 4) {
      const size = this.pending.readUInt32LE(offset);
      if (size === 0 || size > MAX_NATIVE_MESSAGE_BYTES) throw new NativeMessagingError("invalid-message");
      if (this.pending.length - offset - 4 < size) break;
      try {
        const bytes = this.pending.subarray(offset + 4, offset + 4 + size);
        const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        messages.push(JSON.parse(json));
      } catch { throw new NativeMessagingError("invalid-message"); }
      offset += 4 + size;
    }
    this.pending = Buffer.from(this.pending.subarray(offset));
    if (this.pending.length > MAX_NATIVE_MESSAGE_BYTES + 4) throw new NativeMessagingError("invalid-message");
    return messages;
  }
  finish(): void { if (this.pending.length) throw new NativeMessagingError("invalid-message"); }
  clear(): void { this.pending.fill(0); this.pending = Buffer.alloc(0); }
}
export function encodeNativeMessage(value: unknown): Buffer {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { throw new NativeMessagingError("invalid-message"); }
  if (json === undefined) throw new NativeMessagingError("invalid-message");
  const bytes = Buffer.from(json, "utf8");
  if (!bytes.length || bytes.length > MAX_NATIVE_MESSAGE_BYTES) throw new NativeMessagingError("invalid-message");
  const frame = Buffer.allocUnsafe(bytes.length + 4);
  frame.writeUInt32LE(bytes.length, 0); bytes.copy(frame, 4);
  return frame;
}
export interface NativeMessagingPort {
  /** Opaque payload routed privately to the same verified extension, never to agent/tool logs. */
  send(value: unknown): Promise<void>;
  onMessage(listener: (message: unknown) => void): () => void;
  onDisconnect(listener: (reason: NativeMessagingFailure | "closed") => void): () => void;
  close(): void;
}
interface Connection { sender: NativeExtensionSender; port: NativeMessagingPort }
export class NativeMessagingBroker<SenderHandle> {
  private readonly options: NativeMessagingBrokerOptions<SenderHandle>;
  private readonly connections = new Set<Connection>();
  private disposed = false;
  constructor(options: NativeMessagingBrokerOptions<SenderHandle>) { this.options = options; }
  async connect(handle: SenderHandle, hostName: string, signal?: AbortSignal): Promise<NativeMessagingPort> {
    const failure = (code: NativeMessagingFailure): never => { throw new NativeMessagingError(code); };
    if (this.disposed || signal?.aborted) return failure("cancelled");
    if (!HOST_NAME.test(hostName)) return failure("host-not-allowed");
    const policy = this.options.allowedHosts.find(value => value.name === hostName);
    if (!policy) return failure("host-not-allowed");
    const sender = await this.options.resolveSender(handle);
    if (!sender || !EXTENSION_ID.test(sender.extensionId) || !sender.permissions.includes("nativeMessaging"))
      return failure("unauthorized-sender");
    let url: URL;
    try { url = new URL(sender.url); } catch { return failure("unauthorized-sender"); }
    if (url.protocol !== "chrome-extension:" || url.hostname !== sender.extensionId || url.username || url.password ||
        !(await this.options.isAuthorized(sender, hostName))) return failure("unauthorized-sender");
    if (!(await this.options.isBrowserTrusted())) return failure("untrusted-browser");
    const extensionOrigin = "chrome-extension://" + sender.extensionId + "/";
    let executable: string;
    try {
      if (!path.isAbsolute(policy.manifestPath) || !path.isAbsolute(policy.executablePath)) return failure("invalid-host");
      const manifestStat = await fs.stat(policy.manifestPath);
      if (!manifestStat.isFile() || manifestStat.size > 64 * 1024 || (manifestStat.mode & 0o022)) return failure("invalid-host");
      const manifest = JSON.parse(await fs.readFile(policy.manifestPath, "utf8"));
      if (manifest.name !== hostName || manifest.type !== "stdio" || typeof manifest.path !== "string" ||
          !path.isAbsolute(manifest.path) || !Array.isArray(manifest.allowed_origins) ||
          !manifest.allowed_origins.includes(extensionOrigin)) return failure("invalid-host");
      executable = await fs.realpath(policy.executablePath);
      if (await fs.realpath(manifest.path) !== executable) return failure("invalid-host");
      const stat = await fs.stat(executable);
      if (!stat.isFile() || !(stat.mode & 0o111) || (stat.mode & 0o022)) return failure("invalid-host");
    } catch { return failure("invalid-host"); }
    const verify = this.options.verifyHost ?? verifyMacCodeSignature;
    if (!policy.signatureRequirement || !(await verify(executable, policy.signatureRequirement))) return failure("untrusted-host");
    if (this.disposed || signal?.aborted) return failure("cancelled");
    // Re-resolve after disk/signature checks to fence navigations, unloads, or grant revocations.
    const current = await this.options.resolveSender(handle);
    if (!current || current.profileId !== sender.profileId || current.extensionId !== sender.extensionId ||
        current.url !== sender.url || !current.permissions.includes("nativeMessaging") ||
        !(await this.options.isAuthorized(current, hostName))) return failure("unauthorized-sender");
    if ([...this.connections].filter(value => value.sender.profileId === sender.profileId).length >= 16)
      return failure("host-failed");
    // Deliberately exclude provider/API secrets from inherited process environment.
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "USER", "LOGNAME", "__CF_USER_TEXT_ENCODING"])
      if (process.env[key]) env[key] = process.env[key];
    const child = (this.options.launch ?? spawn)(executable, [extensionOrigin], {
      shell: false, stdio: ["pipe", "pipe", "pipe"], env,
    }) as ChildProcessWithoutNullStreams;
    const decoder = new NativeMessageDecoder();
    const messages = new Set<(value: unknown) => void>();
    const disconnects = new Set<(reason: NativeMessagingFailure | "closed") => void>();
    let closed = false, connection: Connection;
    const close = (reason: NativeMessagingFailure | "closed") => {
      if (closed) return;
      closed = true; decoder.clear(); signal?.removeEventListener("abort", onAbort);
      child.stdin.destroy(); child.kill(); this.connections.delete(connection);
      for (const listener of disconnects) { try { listener(reason); } catch { /* No payload logging. */ } }
      messages.clear(); disconnects.clear();
    };
    const onAbort = () => close("cancelled");
    const port: NativeMessagingPort = {
      send: async value => {
        if (closed) throw new NativeMessagingError("cancelled");
        const live = await this.options.resolveSender(handle);
        if (!live || live.profileId !== sender.profileId || live.extensionId !== sender.extensionId ||
            live.url !== sender.url || !live.permissions.includes("nativeMessaging") ||
            !(await this.options.isAuthorized(live, hostName))) {
          close("unauthorized-sender"); throw new NativeMessagingError("unauthorized-sender");
        }
        if (closed) throw new NativeMessagingError("cancelled");
        const frame = encodeNativeMessage(value);
        await new Promise<void>((resolve, reject) => child.stdin.write(frame, error => {
          frame.fill(0);
          if (error) { close("host-failed"); reject(new NativeMessagingError("host-failed")); }
          else resolve();
        }));
      },
      onMessage: listener => { messages.add(listener); return () => { messages.delete(listener); }; },
      onDisconnect: listener => { disconnects.add(listener); return () => { disconnects.delete(listener); }; },
      close: () => close("closed"),
    };
    connection = { sender, port }; this.connections.add(connection);
    child.stdout.on("data", (chunk: Buffer) => {
      if (closed) return;
      try {
        for (const message of decoder.push(chunk)) for (const listener of messages) listener(message);
      } catch { close("invalid-message"); }
    });
    child.stdout.once("end", () => { try { decoder.finish(); } catch { close("invalid-message"); } });
    // Drain and discard stderr. Native hosts may emit sensitive diagnostics.
    child.stderr.resume();
    child.once("error", () => close("host-failed"));
    child.stdin.on("error", () => close("host-failed"));
    child.once("exit", () => close("closed"));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return port;
  }
  revoke(profileId: string, extensionId?: string): void {
    for (const connection of this.connections) if (connection.sender.profileId === profileId &&
      (!extensionId || connection.sender.extensionId === extensionId)) connection.port.close();
  }
  dispose(): void { this.disposed = true; for (const connection of this.connections) connection.port.close(); }
}
