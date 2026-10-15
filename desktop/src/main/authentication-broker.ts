/** No credentials cross this boundary. Providers fill inside the trusted extension runtime. */
import { randomUUID } from "node:crypto";

export type AuthenticationStatus =
  | "awaiting-consent" | "awaiting-unlock" | "filling" | "awaiting-totp"
  | "needs-user" | "authenticated" | "cancelled" | "denied" | "expired" | "failed" | "unavailable";
export interface AuthenticationScope {
  actorId: string;
  workspaceId: string;
  profileId: string;
  agentSessionId: string;
  tabId: string;
  /** Canonical HTTPS origin only, never a full URL containing a login token. */
  origin: string;
}
export interface AuthenticationSnapshot {
  requestId: string;
  scope: AuthenticationScope;
  status: AuthenticationStatus;
  includeTotp: boolean;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
}
export type ProviderProgress = "awaiting-unlock" | "filling" | "awaiting-totp" | "needs-user";
export interface AuthenticationProvider {
  /** Must check actual profile extension availability and genuine native connectivity. */
  available(scope: AuthenticationScope): Promise<boolean>;
  /** Only report authenticated after an observed successful login, not after dispatching fill. */
  authenticate(scope: AuthenticationScope, options: {
    includeTotp: boolean;
    signal: AbortSignal;
    progress: (status: ProviderProgress) => void;
  }): Promise<"authenticated" | "denied" | "needs-user" | "failed" | "unavailable">;
}
export interface AuthenticationBrokerOptions {
  provider?: AuthenticationProvider;
  /** Rechecks current tab/profile/origin and caller's lease before provider execution. */
  isCurrentTarget: (scope: AuthenticationScope) => boolean | Promise<boolean>;
  now?: () => number;
  timeoutMs?: number;
}
interface PendingAuthentication {
  snapshot: AuthenticationSnapshot;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  running: boolean;
}
const TERMINAL = new Set<AuthenticationStatus>([
  "authenticated", "cancelled", "denied", "expired", "failed", "unavailable",
]);
function validateScope(scope: AuthenticationScope): AuthenticationScope {
  for (const key of ["actorId", "workspaceId", "profileId", "agentSessionId", "tabId"] as const) {
    if (typeof scope[key] !== "string" || !/^[a-zA-Z0-9:_-]{1,200}$/.test(scope[key]))
      throw new Error("Invalid authentication scope.");
  }
  const url = new URL(scope.origin);
  if (url.protocol !== "https:" || url.origin !== scope.origin || url.username || url.password)
    throw new Error("Authentication requires a canonical HTTPS origin.");
  // Explicit projection prevents unknown fields (password, OTP, provider details) entering events.
  return { actorId: scope.actorId, workspaceId: scope.workspaceId, profileId: scope.profileId,
    agentSessionId: scope.agentSessionId, tabId: scope.tabId, origin: url.origin };
}
function sameScope(a: AuthenticationScope, b: AuthenticationScope): boolean {
  return a.actorId === b.actorId && a.workspaceId === b.workspaceId && a.profileId === b.profileId &&
    a.agentSessionId === b.agentSessionId && a.tabId === b.tabId && a.origin === b.origin;
}
const snapshot = (entry: PendingAuthentication): AuthenticationSnapshot =>
  ({ ...entry.snapshot, scope: { ...entry.snapshot.scope } });

export class AuthenticationBroker {
  private readonly options: AuthenticationBrokerOptions;
  private readonly pending = new Map<string, PendingAuthentication>();
  private readonly listeners = new Set<(event: AuthenticationSnapshot) => void>();
  private readonly now: () => number;
  private disposed = false;
  constructor(options: AuthenticationBrokerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }
  subscribe(listener: (event: AuthenticationSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Main/control calls this; it never grants consent by requesting authentication. */
  async request(input: AuthenticationScope): Promise<AuthenticationSnapshot> {
    if (this.disposed) throw new Error("Authentication broker is closed.");
    const scope = validateScope(input);
    if (!(await this.options.isCurrentTarget(scope))) throw new Error("Authentication target is no longer authorized.");
    for (const entry of this.pending.values()) {
      if (!TERMINAL.has(entry.snapshot.status) && sameScope(entry.snapshot.scope, scope)) return snapshot(entry);
      if (!TERMINAL.has(entry.snapshot.status) && entry.snapshot.scope.profileId === scope.profileId &&
          entry.snapshot.scope.tabId === scope.tabId) throw new Error("Authentication target is already protected.");
    }
    const requestId = randomUUID(), createdAt = this.now();
    const timeout = Math.min(300_000, Math.max(1000, this.options.timeoutMs ?? 120_000));
    const entry: PendingAuthentication = {
      snapshot: { requestId, scope, status: "awaiting-consent", includeTotp: true,
        createdAt, expiresAt: createdAt + timeout, updatedAt: createdAt },
      running: false, controller: new AbortController(),
      timer: setTimeout(() => this.finish(requestId, "expired"), timeout),
    };
    entry.timer.unref?.();
    this.pending.set(requestId, entry);
    this.emit(entry);
    let available = false;
    try { available = await this.options.provider?.available(scope) ?? false; }
    catch { /* Provider errors may contain secrets. Never forward their text. */ }
    if (!available) this.finish(requestId, "unavailable");
    return snapshot(entry);
  }
  get(requestId: string, scope: AuthenticationScope): AuthenticationSnapshot | undefined {
    const entry = this.match(requestId, scope);
    return entry ? snapshot(entry) : undefined;
  }
  /** Only the trusted human chrome consent handler may call acknowledge; never expose as MCP. */
  async acknowledge(requestId: string, scope: AuthenticationScope, options: { includeTotp?: boolean } = {}): Promise<AuthenticationSnapshot> {
    const entry = this.match(requestId, scope);
    if (!entry) throw new Error("Unknown authentication request or scope.");
    if (TERMINAL.has(entry.snapshot.status) || entry.running) return snapshot(entry);
    if (this.now() >= entry.snapshot.expiresAt) { this.finish(requestId, "expired"); return snapshot(entry); }
    if (!(await this.options.isCurrentTarget(entry.snapshot.scope))) {
      this.finish(requestId, "cancelled"); return snapshot(entry);
    }
    // Recheck after asynchronous target validation to fence cancellation/takeover races.
    if (TERMINAL.has(entry.snapshot.status) || entry.running) return snapshot(entry);
    entry.running = true;
    entry.snapshot.includeTotp = options.includeTotp !== false;
    this.update(entry, "awaiting-unlock");
    if (!this.options.provider) { this.finish(requestId, "unavailable"); return snapshot(entry); }
    try {
      const result = await this.options.provider.authenticate({ ...entry.snapshot.scope }, {
        includeTotp: entry.snapshot.includeTotp,
        signal: entry.controller.signal,
        progress: status => {
          if (["awaiting-unlock", "filling", "awaiting-totp", "needs-user"].includes(status) &&
              !TERMINAL.has(entry.snapshot.status)) this.update(entry, status);
        },
      });
      if (!TERMINAL.has(entry.snapshot.status)) {
        if (!(await this.options.isCurrentTarget(entry.snapshot.scope))) this.finish(requestId, "cancelled");
        else if (result === "needs-user") { entry.running = false; this.update(entry, "needs-user"); }
        else this.finish(requestId, ["authenticated", "denied", "failed", "unavailable"].includes(result) ? result : "failed");
      }
    } catch { if (!TERMINAL.has(entry.snapshot.status)) this.finish(requestId, "failed"); }
    return snapshot(entry);
  }
  cancel(requestId: string, scope: AuthenticationScope): AuthenticationSnapshot | undefined {
    const entry = this.match(requestId, scope);
    if (!entry) return undefined;
    this.finish(requestId, "cancelled");
    return snapshot(entry);
  }
  /** Main calls on navigation, takeover, grant revocation, and tab/profile destruction. */
  cancelForSession(agentSessionId: string): void {
    for (const entry of this.pending.values()) if (entry.snapshot.scope.agentSessionId === agentSessionId)
      this.finish(entry.snapshot.requestId, "cancelled");
  }
  isProtectedTarget(profileId: string, tabId: string): boolean {
    return [...this.pending.values()].some(entry => entry.snapshot.scope.profileId === profileId &&
      entry.snapshot.scope.tabId === tabId && !TERMINAL.has(entry.snapshot.status));
  }
  dispose(): void {
    this.disposed = true;
    for (const entry of this.pending.values()) this.finish(entry.snapshot.requestId, "cancelled");
    this.listeners.clear(); this.pending.clear();
  }
  private match(requestId: string, scope: AuthenticationScope): PendingAuthentication | undefined {
    const entry = this.pending.get(requestId);
    return entry && sameScope(entry.snapshot.scope, scope) ? entry : undefined;
  }
  private finish(requestId: string, status: AuthenticationStatus): void {
    const entry = this.pending.get(requestId);
    if (!entry || TERMINAL.has(entry.snapshot.status)) return;
    clearTimeout(entry.timer);
    entry.controller.abort();
    this.update(entry, status);
    // Bounded in-memory receipts; no credential or authentication transcript persistence.
    if (this.pending.size > 200) {
      for (const [id, old] of this.pending) if (id !== requestId && TERMINAL.has(old.snapshot.status)) {
        this.pending.delete(id); if (this.pending.size <= 200) break;
      }
    }
  }
  private update(entry: PendingAuthentication, status: AuthenticationStatus): void {
    entry.snapshot.status = status; entry.snapshot.updatedAt = this.now(); this.emit(entry);
  }
  private emit(entry: PendingAuthentication): void {
    for (const listener of this.listeners) { try { listener(snapshot(entry)); } catch { /* No diagnostic payloads. */ } }
  }
}
