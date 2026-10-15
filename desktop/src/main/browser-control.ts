import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WebContents } from "electron";
import {
  browserControlCommandSchema, controlGrantSchema, controlSessionInputSchema,
  type AuthenticationOutcome, type AuthenticationRequest, type BrowserControlCapabilities,
  type BrowserControlCommand, type BrowserControlEvent, type BrowserControlReceipt,
  type BrowserControlSession, type BrowserObservation, type ControlCapability,
  type ControlEventPage, type ControlGrantInput, type ControlGrantSummary, type ControlSessionInput,
} from "../shared/browser-control";
import {
  BrowserControlError, NativeBrowserControlDriver, safeControlUrl,
  type BrowserControlDriver, type ControlExecutionContext,
} from "./browser-control-native";

/** Structural seam only. ArcCore remains the single owner of native views. */
export interface BrowserControlCore {
  snapshot(): {
    spaces: { id: string }[];
    tabs: { id: string; spaceId: string; ownerSessionId?: string; url: string; loading: boolean; title: string }[];
  };
  newTab(options: { spaceId: string; url: string; background: boolean; ownerSessionId: string }): { id: string };
  getProfileId(spaceId: string): string;
  getWebContentsForTab(tabId: string): WebContents | null | undefined;
  createFolder(spaceId: string, name: string): { id: string };
  moveToFolder(tabId: string, folderId: string | null): void;
  closeTab(tabId: string): void;
  setTabOwner(tabId: string, ownerSessionId: string | undefined): void;
  onState(listener: () => void): () => void;
}
export interface BrowserControlOptions {
  /** Native app-private metadata location, not a browser profile or token file. */
  stateFile?: string;
  driver?: BrowserControlDriver;
  authenticate?: (request: AuthenticationRequest) => Promise<AuthenticationOutcome>;
  isProtectedTarget?: (profileId: string, tabId: string) => boolean;
  now?: () => number;
}
type Grant = ControlGrantSummary & { hash: Buffer; sessionIds: Set<string>; boundSessionId?: string };
type StoredRequest = { fingerprint: string; receipt: BrowserControlReceipt };
type ActiveExecution = { abort: AbortController; requestId: string };
type StoredState = { version: 1; sessions: BrowserControlSession[]; requests: [string, StoredRequest][]; creations: [string, { fingerprint: string; sessionId: string }][] };
const hash = (value: string) => createHash("sha256").update(value).digest();
const copy = <T>(value: T): T => structuredClone(value);
const requestKey = (actorId: string, requestId: string) => JSON.stringify([actorId, requestId]);
const capability = (action: BrowserControlCommand["action"]): ControlCapability => {
  if (["observe", "session.status"].includes(action)) return "observe";
  if (action === "navigate") return "navigate";
  if (action.startsWith("tab.")) return "tabs";
  if (action.startsWith("cdp")) return "cdp";
  if (action === "authenticate") return "authenticate";
  if (action === "download") return "downloads";
  return "interact";
};
const mutates = (action: BrowserControlCommand["action"]) => !["observe", "session.status", "cdp.target"].includes(action);

export class BrowserControlService {
  readonly epoch = randomUUID();
  private readonly core: BrowserControlCore;
  private readonly options: BrowserControlOptions;
  private readonly driver: BrowserControlDriver;
  private readonly grants = new Map<string, Grant>();
  private readonly sessions = new Map<string, BrowserControlSession>();
  private readonly requests = new Map<string, StoredRequest>();
  private readonly creations = new Map<string, { fingerprint: string; sessionId: string }>();
  private readonly active = new Map<string, ActiveExecution>();
  private readonly observations = new Map<string, { documentId: string; revision: number; fence: number }>();
  private readonly watched = new Map<string, { wc: WebContents; cleanup(): void }>();
  private readonly listeners = new Set<(event: BrowserControlEvent) => void>();
  private readonly eventLog: BrowserControlEvent[] = [];
  private readonly unsubscribe: () => void;
  private cursor = 0;
  private disposed = false;
  private readonly now: () => number;
  private readonly expiryTimer: ReturnType<typeof setInterval>;

  constructor(core: BrowserControlCore, options: BrowserControlOptions = {}) {
    this.core = core;
    this.options = options;
    this.driver = options.driver || new NativeBrowserControlDriver();
    this.now = options.now || Date.now;
    this.restore();
    this.unsubscribe = core.onState(() => this.reconcile());
    this.reconcile();
    this.expiryTimer = setInterval(() => {
      for (const grant of this.grants.values()) if (!grant.revoked && grant.expiresAt <= this.now()) this.revokeGrant(grant.grantId);
    }, 1000);
    this.expiryTimer.unref();
  }

  capabilities(): BrowserControlCapabilities {
    return { version: 1, singleWindow: true, backgroundTabs: true, interactiveNativeSession: true, presentation: "native-host-bounds", cdpMethods: ["Page.navigate", "Target.getTargetInfo"], unavailable: [
      "Raw CDP, arbitrary JavaScript evaluation, cookies, credential extraction, screenshots, and file-system access are not exposed.",
      "Cross-origin frame and closed-shadow-root interaction is unavailable.",
      ...(!this.options.authenticate ? ["Authentication provider is not connected."] : []),
      "Hosted interactive browser streaming is not implemented by this local bridge.",
    ] };
  }
  /** Trusted native UI only. Never mount this method on the MCP endpoint. */
  createGrant(input: ControlGrantInput): { grantId: string; token: string } {
    this.assertRunning();
    const value = controlGrantSchema.parse(input);
    const snapshot = this.core.snapshot();
    if (value.workspaceIds.some((workspaceId) => !snapshot.spaces.some((space) => space.id === workspaceId))) throw new BrowserControlError("WORKSPACE_NOT_FOUND", "Workspace unavailable.");
    if (value.authorizedTabIds.some((id) => !snapshot.tabs.some((tab) => tab.id === id && value.workspaceIds.includes(tab.spaceId)))) throw new BrowserControlError("TAB_OUT_OF_SCOPE", "Explicit tab authorization must belong to a granted Workspace.");
    const token = randomBytes(32).toString("base64url"), grantId = `grant_${randomUUID()}`;
    this.grants.set(grantId, { ...value, grantId, hash: hash(token), sessionIds: new Set(), expiresAt: this.now() + value.ttlMs, revoked: false });
    return { grantId, token };
  }
  listGrants(): ControlGrantSummary[] {
    return [...this.grants.values()].map(({ hash: _hash, sessionIds: _sessions, boundSessionId: _bound, ...grant }) => copy(grant));
  }
  revokeGrant(grantId: string): void {
    const grant = this.grants.get(grantId);
    if (!grant || grant.revoked) return;
    grant.revoked = true;
    for (const sessionId of grant.sessionIds) this.takeover(sessionId);
  }
  /** Explicit native authorization for a restored conversation. No network caller can invoke this. */
  bindGrantToSession(grantId: string, sessionId: string): void {
    const grant = this.grants.get(grantId), session = this.sessions.get(sessionId);
    if (!grant || grant.revoked || grant.expiresAt <= this.now() || !session || session.actorId !== grant.actorId || !grant.workspaceIds.includes(session.workspaceId)) throw new BrowserControlError("SESSION_OUT_OF_SCOPE", "Session is not authorized.");
    grant.boundSessionId = sessionId;
    grant.sessionIds = new Set([sessionId]);
  }
  /** Throws without revealing whether a token or session exists. */
  private authorize(token: string): Grant {
    this.assertRunning();
    if (typeof token !== "string" || token.length > 256) throw new BrowserControlError("UNAUTHORIZED", "A valid native pairing is required.");
    const candidate = hash(token);
    for (const grant of this.grants.values()) {
      if (!timingSafeEqual(candidate, grant.hash)) continue;
      if (!grant.revoked && grant.expiresAt > this.now()) return grant;
      this.revokeGrant(grant.grantId);
      break;
    }
    throw new BrowserControlError("UNAUTHORIZED", "A valid native pairing is required.");
  }
  validateToken(token: string): void { this.authorize(token); }
  private sessionFor(grant: Grant, sessionId: string): BrowserControlSession {
    const session = this.sessions.get(sessionId);
    if (!session || !grant.sessionIds.has(sessionId) || (grant.boundSessionId && grant.boundSessionId !== sessionId) || session.actorId !== grant.actorId || !grant.workspaceIds.includes(session.workspaceId)) throw new BrowserControlError("SESSION_OUT_OF_SCOPE", "Session is not authorized.");
    if (this.core.getProfileId(session.workspaceId) !== session.profileId) throw new BrowserControlError("PROFILE_CHANGED", "The Workspace profile changed; create a new scoped session.");
    return session;
  }
  private requireCapability(grant: Grant, required: ControlCapability): void {
    if (!grant.capabilities.includes(required)) throw new BrowserControlError("CAPABILITY_DENIED", "This capability was not granted by the user.");
  }
  createSession(token: string, input: ControlSessionInput): BrowserControlSession {
    const grant = this.authorize(token), value = controlSessionInputSchema.parse(input);
    this.requireCapability(grant, "tabs");
    if (!grant.workspaceIds.includes(value.workspaceId)) throw new BrowserControlError("WORKSPACE_OUT_OF_SCOPE", "Workspace not authorized.");
    if (grant.boundSessionId) {
      const bound = this.sessionFor(grant, grant.boundSessionId);
      if (bound.workspaceId !== value.workspaceId || bound.conversationId !== value.conversationId) throw new BrowserControlError("SESSION_OUT_OF_SCOPE", "Grant is bound to another conversation.");
      return copy(bound);
    }
    const key = requestKey(grant.actorId, value.requestId), fingerprint = hash(JSON.stringify(value)).toString("hex");
    const existing = this.creations.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new BrowserControlError("REQUEST_CONFLICT", "Request ID was already used with different arguments.");
      const session = this.sessions.get(existing.sessionId);
      if (!session || !grant.sessionIds.has(session.id)) throw new BrowserControlError("REAUTHORIZE_SESSION", "Native authorization is required to reconnect to the prior session.");
      return copy(session);
    }
    if (this.creations.size >= 10000) throw new BrowserControlError("REQUEST_LIMIT", "Local request journal capacity reached; do not automatically retry.");
    const sessionId = `control_${randomUUID()}`;
    // Persist intent before allocating a tab. A crash cannot silently create another tab on retry.
    this.creations.set(key, { fingerprint, sessionId });
    this.persist();
    const group = this.core.createFolder(value.workspaceId, value.title);
    const tab = this.core.newTab({ spaceId: value.workspaceId, url: "about:blank", background: true, ownerSessionId: sessionId });
    this.core.moveToFolder(tab.id, group.id);
    const session: BrowserControlSession = {
      id: sessionId, actorId: grant.actorId, workspaceId: value.workspaceId,
      profileId: this.core.getProfileId(value.workspaceId), browserSessionId: `browser_${randomUUID()}`,
      conversationId: value.conversationId, groupId: group.id, tabIds: [tab.id], primaryTabId: tab.id,
      revision: 0, fence: 0, controller: "agent", needsObservation: true, createdAt: this.now(),
    };
    this.sessions.set(sessionId, session);
    grant.sessionIds.add(sessionId);
    this.watch(tab.id, session);
    this.persist();
    this.emit(session, { type: "session" });
    return copy(session);
  }
  getSessionForTab(tabId: string): BrowserControlSession | undefined {
    const session = [...this.sessions.values()].find((candidate) => candidate.tabIds.includes(tabId));
    return session ? copy(session) : undefined;
  }
  isAgentOwnedTab(tabId: string): boolean { return Boolean(this.getSessionForTab(tabId)); }
  isTabAgentControlled(tabId: string): boolean { return this.getSessionForTab(tabId)?.controller === "agent"; }
  takeoverTab(tabId: string): void { const session = this.getSessionForTab(tabId); if (session) this.takeover(session.id); }
  takeover(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.controller = "human";
    session.needsObservation = true;
    session.fence++;
    session.revision++;
    for (const tabId of session.tabIds) this.observations.delete(tabId);
    this.active.get(sessionId)?.abort.abort();
    this.persist();
    this.emit(session, { type: "ownership" });
  }
  resume(token: string, sessionId: string): BrowserControlSession {
    const grant = this.authorize(token), session = this.sessionFor(grant, sessionId);
    if (this.active.has(sessionId)) throw new BrowserControlError("SESSION_BUSY", "Wait for the interrupted native action to settle.");
    const observed = this.observations.get(session.primaryTabId);
    if (!observed || observed.revision !== session.revision || observed.fence !== session.fence || session.needsObservation) throw new BrowserControlError("OBSERVATION_REQUIRED", "Fresh observation is required before returning browser control.");
    session.controller = "agent";
    this.persist();
    this.emit(session, { type: "ownership" });
    return copy(session);
  }
  async reobserveAndResume(token: string, sessionId: string): Promise<BrowserControlSession> {
    const session = this.sessionFor(this.authorize(token), sessionId);
    const receipt = await this.execute(token, { version: 1, requestId: `resume_${randomUUID()}`, sessionId, tabId: session.primaryTabId, action: "observe" });
    if (receipt.status !== "observed") throw new BrowserControlError(receipt.code || "OBSERVATION_REQUIRED", receipt.message || "Fresh observation is required.");
    return this.resume(token, sessionId);
  }
  async execute(token: string, raw: unknown): Promise<BrowserControlReceipt> {
    const grant = this.authorize(token);
    const parsed = browserControlCommandSchema.safeParse(raw);
    if (!parsed.success) throw new BrowserControlError("INVALID_COMMAND", "Command does not match the v1 schema.");
    const command = parsed.data, session = this.sessionFor(grant, command.sessionId);
    const receipt = (status: BrowserControlReceipt["status"], rest: Partial<BrowserControlReceipt> = {}): BrowserControlReceipt => ({ version: 1, requestId: command.requestId, sessionId: session.id, action: command.action, status, revision: session.revision, ...rest });
    const key = requestKey(grant.actorId, command.requestId), fingerprint = hash(JSON.stringify(command)).toString("hex");
    const old = this.requests.get(key);
    if (old) return old.fingerprint === fingerprint ? copy(old.receipt) : receipt("failed", { code: "REQUEST_CONFLICT", message: "Request ID was already used with different arguments." });
    let started = false, active: ActiveExecution | undefined;
    try {
      this.requireCapability(grant, capability(command.action));
      if (command.action === "cdp") this.requireCapability(grant, "navigate");
      if (command.action === "cdp.target") this.requireCapability(grant, "observe");
      if (this.active.has(session.id)) throw new BrowserControlError("SESSION_BUSY", "Another browser action is in flight.");
      const mutation = mutates(command.action);
      if (mutation && session.controller !== "agent") throw new BrowserControlError("HUMAN_CONTROL", "The human owns browser control.");
      if (mutation && "expectedRevision" in command && command.expectedRevision !== session.revision) throw new BrowserControlError("STALE_REVISION", "Observe current state before performing another action.");
      if (mutation && session.needsObservation) throw new BrowserControlError("OBSERVATION_REQUIRED", "Observe the current browser state first.");
      if (command.action === "session.status") return receipt("observed", { result: copy(session) });
      const tabId = "tabId" in command ? command.tabId : session.primaryTabId;
      const tab = this.core.snapshot().tabs.find((candidate) => candidate.id === tabId);
      if (!tab || tab.spaceId !== session.workspaceId) throw new BrowserControlError("TAB_OUT_OF_SCOPE", "Target does not belong to this Workspace.");
      if (command.action !== "tab.adopt" && !session.tabIds.includes(tabId)) throw new BrowserControlError("TAB_OUT_OF_SCOPE", "Target does not belong to this agent session.");
      if (command.action === "tab.adopt") {
        if (!grant.authorizedTabIds.includes(tabId) || this.isAgentOwnedTab(tabId)) throw new BrowserControlError("TAB_OUT_OF_SCOPE", "The user has not authorized adoption of this tab.");
      }
      if (command.action === "tab.create" && !grant.allowAdditionalTabs) throw new BrowserControlError("ONE_TAB_POLICY", "Additional tabs were not authorized for this task.");
      if (this.options.isProtectedTarget?.(session.profileId, tabId) && !["authenticate", "tab.close"].includes(command.action)) throw new BrowserControlError("AUTHENTICATION_PROTECTED", "Authentication is in progress. Page observations and input are withheld.");
      const wc = this.core.getWebContentsForTab(tabId);
      if (!wc || wc.isDestroyed()) throw new BrowserControlError("TARGET_UNAVAILABLE", "The native browser target is unavailable.");
      this.watch(tabId, session);
      const fence = session.fence;
      active = { abort: new AbortController(), requestId: command.requestId };
      this.active.set(session.id, active);
      const context: ControlExecutionContext = {
        signal: active.abort.signal,
        documentId: this.observations.get(tabId)?.documentId,
        assertCurrent: () => {
          this.authorize(token);
          if (active!.abort.signal.aborted || session.fence !== fence || (mutation && session.controller !== "agent")) throw new BrowserControlError("CONTROL_INTERRUPTED", "Browser control changed; the result may be uncertain.", started);
          if (this.core.getProfileId(session.workspaceId) !== session.profileId || !this.core.snapshot().tabs.some((current) => current.id === tabId && current.spaceId === session.workspaceId)) throw new BrowserControlError("TARGET_CHANGED", "Target changed during execution.", started);
          if (command.action !== "authenticate" && this.options.isProtectedTarget?.(session.profileId, tabId)) throw new BrowserControlError("AUTHENTICATION_PROTECTED", "Authentication content is withheld.", started);
        },
      };
      context.assertCurrent();
      if (mutation) {
        if (this.requests.size >= 10000) throw new BrowserControlError("REQUEST_LIMIT", "Request journal capacity reached; do not automatically retry.");
        this.requests.set(key, { fingerprint, receipt: receipt("uncertain", { code: "ACTION_PENDING", message: "Native action is in flight; never replay automatically." }) });
        this.persist();
      }
      started = true;
      this.emit(session, { type: "activity", active: true, requestId: command.requestId, action: command.action });
      let result: BrowserControlReceipt;
      if (command.action === "observe") {
        const before = session.revision;
        const observation = await this.driver.observe(wc, tabId, context);
        context.assertCurrent();
        if (session.revision !== before) throw new BrowserControlError("STALE_OBSERVATION", "Page changed during observation. Observe again.");
        const previous = this.observations.get(tabId);
        if (previous && previous.documentId !== observation.documentId) session.revision++;
        this.observations.set(tabId, { documentId: observation.documentId, revision: session.revision, fence: session.fence });
        session.needsObservation = false;
        result = receipt("observed", { result: { ...observation, revision: session.revision } as BrowserObservation });
      } else if (command.action === "tab.create") {
        const created = this.core.newTab({ spaceId: session.workspaceId, url: command.url || "about:blank", background: true, ownerSessionId: session.id });
        this.core.moveToFolder(created.id, session.groupId);
        session.tabIds.push(created.id);
        this.watch(created.id, session);
        result = receipt("observed", { result: { tabId: created.id } });
      } else if (command.action === "tab.adopt") {
        this.core.setTabOwner(tabId, session.id);
        session.tabIds.push(tabId);
        this.watch(tabId, session);
        result = receipt("observed", { result: { tabId, adopted: true } });
      } else if (command.action === "tab.close") {
        // Do not close a pinned/reset-only Arc tab as if it had disappeared.
        this.core.closeTab(tabId);
        const remains = this.core.snapshot().tabs.some((candidate) => candidate.id === tabId);
        result = receipt(remains ? "accepted" : "observed", { result: { tabId, closed: !remains, reset: remains } });
      } else if (command.action === "authenticate") {
        const origin = new URL(command.origin).origin;
        if (command.origin !== origin || origin !== new URL(wc.getURL()).origin) throw new BrowserControlError("ORIGIN_MISMATCH", "Authentication must match the exact current origin.");
        const outcome = this.options.authenticate ? await this.options.authenticate({ actorId: grant.actorId, sessionId: session.id, workspaceId: session.workspaceId, profileId: session.profileId, tabId, origin, includeTotp: command.includeTotp, signal: context.signal }) : { status: "unavailable" as const };
        context.assertCurrent();
        result = receipt(outcome.status === "filled" ? "observed" : outcome.status === "awaiting-user" ? "accepted" : "failed", { result: { status: outcome.status }, ...(outcome.status === "unavailable" ? { code: "AUTH_PROVIDER_UNAVAILABLE", message: "The verified authentication provider is not available." } : {}) });
      } else {
        const native = await this.driver.perform(wc, command, context);
        context.assertCurrent();
        result = receipt(native.status, { result: native.result });
      }
      if (mutation) { session.revision++; session.needsObservation = true; result.revision = session.revision; this.requests.set(key, { fingerprint, receipt: copy(result) }); }
      this.persist();
      this.emit(session, { type: "receipt", requestId: command.requestId, action: command.action, status: result.status });
      return result;
    } catch (error) {
      // Never forward raw Electron/provider errors; these can contain URLs, input values or tokens.
      const known = error instanceof BrowserControlError;
      const result = receipt(started && (!known || error.uncertain) ? "uncertain" : "failed", {
        code: known ? error.code : "NATIVE_ACTION_FAILED",
        message: known ? error.message : "Native action failed. Observe before retrying; do not automatically repeat mutations.",
      });
      if (started && mutates(command.action)) {
        session.revision++; session.needsObservation = true; result.revision = session.revision;
        this.requests.set(key, { fingerprint, receipt: copy(result) });
        this.persist();
      }
      return result;
    } finally {
      if (active && this.active.get(session.id) === active) this.active.delete(session.id);
      if (started) this.emit(session, { type: "activity", active: false, requestId: command.requestId, action: command.action });
    }
  }
  subscribe(listener: (event: BrowserControlEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  events(token: string, input: { epoch?: string; after?: number } = {}): ControlEventPage {
    const grant = this.authorize(token), after = input.after || 0;
    const resetRequired = Boolean((input.epoch && input.epoch !== this.epoch) || after > this.cursor || (this.eventLog.length && after < this.eventLog[0]!.cursor - 1));
    return { epoch: this.epoch, cursor: this.cursor, resetRequired, events: this.eventLog.filter((event) => grant.sessionIds.has(event.sessionId) && event.cursor > (resetRequired ? 0 : after)).map(copy) };
  }
  private emit(session: BrowserControlSession, event: Pick<BrowserControlEvent, "type"> & Partial<BrowserControlEvent>): void {
    const value: BrowserControlEvent = { version: 1, epoch: this.epoch, cursor: ++this.cursor, sessionId: session.id, actorId: session.actorId, revision: session.revision, at: this.now(), ...event };
    this.eventLog.push(value);
    if (this.eventLog.length > 1000) this.eventLog.shift();
    for (const listener of this.listeners) { try { listener(copy(value)); } catch { /* An observer cannot break native control. */ } }
  }
  private watch(tabId: string, session: BrowserControlSession): void {
    const wc = this.core.getWebContentsForTab(tabId);
    if (!wc || wc.isDestroyed() || this.watched.get(tabId)?.wc === wc) return;
    this.watched.get(tabId)?.cleanup();
    const changed = () => { session.revision++; session.needsObservation = true; this.observations.delete(tabId); };
    wc.on("did-start-navigation", changed);
    wc.on("did-navigate-in-page", changed);
    wc.on("destroyed", changed);
    this.watched.set(tabId, { wc, cleanup: () => { wc.removeListener("did-start-navigation", changed); wc.removeListener("did-navigate-in-page", changed); wc.removeListener("destroyed", changed); } });
  }
  private reconcile(): void {
    const tabs = this.core.snapshot().tabs;
    for (const session of this.sessions.values()) {
      const remaining = session.tabIds.filter((id) => tabs.some((tab) => tab.id === id && tab.spaceId === session.workspaceId));
      if (remaining.length !== session.tabIds.length) {
        session.tabIds = remaining;
        if (!remaining.includes(session.primaryTabId)) session.primaryTabId = remaining[0] || "";
        this.takeover(session.id);
      }
      for (const tabId of remaining) this.watch(tabId, session);
    }
    for (const [tabId, watched] of this.watched) if (!tabs.some((tab) => tab.id === tabId)) { watched.cleanup(); this.watched.delete(tabId); }
  }
  private assertRunning(): void { if (this.disposed) throw new BrowserControlError("DISPOSED", "Browser control is stopped."); }
  private restore(): void {
    if (!this.options.stateFile || !existsSync(this.options.stateFile)) return;
    try {
      const state = JSON.parse(readFileSync(this.options.stateFile, "utf8")) as StoredState;
      if (state.version !== 1 || !Array.isArray(state.sessions) || !Array.isArray(state.requests) || !Array.isArray(state.creations)) throw new Error("Invalid journal");
      for (const session of state.sessions) {
        if (!session || typeof session.id !== "string" || !Array.isArray(session.tabIds) || typeof session.actorId !== "string" || typeof session.workspaceId !== "string") continue;
        this.sessions.set(session.id, { ...session, controller: "human", needsObservation: true, fence: (session.fence || 0) + 1, revision: (session.revision || 0) + 1 });
      }
      for (const [key, value] of state.requests) if (typeof key === "string" && value?.fingerprint && value?.receipt) this.requests.set(key, value);
      for (const [key, value] of state.creations) if (typeof key === "string" && value?.fingerprint && value?.sessionId) this.creations.set(key, value);
    } catch { throw new BrowserControlError("JOURNAL_UNAVAILABLE", "Control journal could not be restored. Repair or explicitly archive it before pairing; automatic replay is disabled."); }
  }
  private persist(): void {
    if (!this.options.stateFile) return;
    const file = this.options.stateFile;
    // Only mutation receipts are journaled. Observations and submitted values never reach disk.
    const data: StoredState = { version: 1, sessions: [...this.sessions.values()], requests: [...this.requests], creations: [...this.creations] };
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  dispose(): void {
    if (this.disposed) return;
    for (const session of this.sessions.values()) this.takeover(session.id);
    this.disposed = true;
    clearInterval(this.expiryTimer);
    this.unsubscribe();
    for (const watched of this.watched.values()) watched.cleanup();
    this.watched.clear(); this.listeners.clear(); this.grants.clear();
  }
}

export { BrowserControlError, safeControlUrl };
