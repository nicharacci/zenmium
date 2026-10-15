import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { build } from "vite";
import type { BrowserControlCore } from "../src/main/browser-control.ts";
import type { BrowserControlDriver } from "../src/main/browser-control-native.ts";
import type { BrowserControlCommand, BrowserControlSession } from "../src/shared/browser-control.ts";

// Bundle extensionless app imports in memory, matching electron-vite without launching Chromium.
const bundled = await build({ configFile: false, logLevel: "silent", build: { write: false, minify: false, target: "node22", lib: { entry: resolve(import.meta.dirname, "browser-control-exports.ts"), formats: ["es"] }, rollupOptions: { external: (id) => id.startsWith("node:") } } });
const output = (Array.isArray(bundled) ? bundled[0] : bundled) as { output: { type: string; code: string }[] };
const code = `${output.output.find((entry) => entry.type === "chunk")!.code}\n//# sourceURL=zenmium-control-unit.mjs`;
const { BrowserControlService, BrowserControlError, startBrowserControlBridge, BrowserControlClient, redactControlText, safeControlUrl, browserControlCommandSchema } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`) as typeof import("./browser-control-exports.ts");

class FakeContents extends EventEmitter {
  id = Math.random();
  url = "about:blank";
  destroyed = false;
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
}
function fixture(options: { stateFile?: string; now?: () => number; protected?: () => boolean } = {}) {
  let sequence = 0, count = 0, hold: (() => Promise<void>) | undefined;
  const tabs = [{ id: "human", spaceId: "work", url: "https://example.test/", title: "Human", loading: false, ownerSessionId: undefined as string | undefined }];
  const views = new Map<string, FakeContents>([["human", new FakeContents()]]);
  const state = new EventEmitter();
  const newTabOptions: object[] = [];
  const core = {
    snapshot: () => ({ spaces: [{ id: "work" }, { id: "private" }], tabs: structuredClone(tabs) }),
    newTab: (options: { spaceId: string; url: string; background: boolean; ownerSessionId: string }) => {
      newTabOptions.push(options);
      const tab = { id: `tab_${++sequence}`, ...options, title: "Agent", loading: false };
      tabs.push(tab); views.set(tab.id, new FakeContents()); state.emit("state"); return tab;
    },
    getProfileId: (id: string) => `profile_${id}`,
    getWebContentsForTab: (id: string) => views.get(id),
    createFolder: () => ({ id: `group_${++sequence}` }), moveToFolder: () => {},
    setTabOwner: (id: string, owner: string | undefined) => { const tab = tabs.find((tab) => tab.id === id); if (tab) tab.ownerSessionId = owner; },
    closeTab: (id: string) => { const index = tabs.findIndex((tab) => tab.id === id); if (index >= 0) tabs.splice(index, 1); state.emit("state"); },
    onState: (listener: () => void) => { state.on("state", listener); return () => { state.off("state", listener); }; },
  } as unknown as BrowserControlCore;
  const driver: BrowserControlDriver = {
    observe: async (wc, tabId, context) => { context.assertCurrent(); return { tabId, url: wc.getURL(), title: "Fixture", text: "Safe text", documentId: `doc_${count}`, elements: [{ ref: "el_1", role: "button", name: "Action", disabled: false, editable: false }], authenticationRequired: false, redacted: true, unsupportedFrames: false }; },
    perform: async (wc, command, context) => {
      context.assertCurrent(); count++;
      if (hold) await hold();
      context.assertCurrent();
      if (command.action === "navigate") (wc as unknown as FakeContents).url = command.url;
      return { status: "observed", result: { dispatched: true } };
    },
  };
  const service = new BrowserControlService(core, { driver, stateFile: options.stateFile, now: options.now, isProtectedTarget: options.protected });
  const grant = service.createGrant({ actorId: "agent", workspaceIds: ["work"], capabilities: ["observe", "navigate", "interact", "tabs", "downloads", "authenticate", "cdp"] });
  const session = service.createSession(grant.token, { requestId: "start", workspaceId: "work", conversationId: "chat" });
  const observe = (requestId = `observe_${++sequence}`, target = session.primaryTabId) => service.execute(grant.token, { version: 1, requestId, sessionId: session.id, tabId: target, action: "observe" });
  const command = (sessionState: { revision: number }, overrides: object = {}) => ({ version: 1, requestId: `action_${++sequence}`, sessionId: session.id, tabId: session.primaryTabId, expectedRevision: sessionState.revision, action: "click", ref: "el_1", ...overrides }) as BrowserControlCommand;
  return { service, grant, session, tabs, views, core, newTabOptions, observe, command, count: () => count, hold: (callback: () => Promise<void>) => { hold = callback; } };
}

test("agent session creates exactly one background owned tab and never adopts human tabs", async () => {
  const f = fixture();
  try {
    assert.equal(f.newTabOptions.length, 1);
    assert.equal((f.newTabOptions[0] as { background: boolean }).background, true);
    assert.equal(f.session.tabIds.length, 1);
    assert.equal(f.service.isAgentOwnedTab("human"), false);
    const observed = await f.observe();
    assert.equal((await f.service.execute(f.grant.token, f.command(observed, { tabId: "human" }))).code, "TAB_OUT_OF_SCOPE");
    const create = { version: 1, requestId: "extra", sessionId: f.session.id, expectedRevision: observed.revision, action: "tab.create" };
    assert.equal((await f.service.execute(f.grant.token, create)).code, "ONE_TAB_POLICY");
    assert.equal(f.count(), 0);
  } finally { f.service.dispose(); }
});
test("session creation retries are idempotent and require the identical request", () => {
  const f = fixture();
  try {
    const session = f.service.createSession(f.grant.token, { requestId: "start", workspaceId: "work", conversationId: "chat" });
    assert.equal(session.id, f.session.id); assert.equal(f.newTabOptions.length, 1);
    assert.throws(() => f.service.createSession(f.grant.token, { requestId: "start", workspaceId: "work", title: "Different" }), /different arguments/);
  } finally { f.service.dispose(); }
});
test("mutations require observation then reject stale revisions", async () => {
  const f = fixture();
  try {
    assert.equal((await f.service.execute(f.grant.token, f.command(f.session))).code, "OBSERVATION_REQUIRED");
    const observed = await f.observe();
    const result = await f.service.execute(f.grant.token, f.command(observed));
    assert.equal(result.status, "observed");
    assert.equal((await f.service.execute(f.grant.token, f.command(observed))).code, "STALE_REVISION");
    assert.equal(f.count(), 1);
  } finally { f.service.dispose(); }
});
test("request IDs prevent duplicate mutations including conflicting reuse", async () => {
  const f = fixture();
  try {
    const input = f.command(await f.observe(), { requestId: "once" });
    const first = await f.service.execute(f.grant.token, input);
    assert.deepEqual(await f.service.execute(f.grant.token, input), first);
    assert.equal((await f.service.execute(f.grant.token, { ...input, action: "fill", text: "changed" })).code, "REQUEST_CONFLICT");
    assert.equal(f.count(), 1);
  } finally { f.service.dispose(); }
});
test("human takeover fences in-flight mutations, requires fresh observation before resume", async () => {
  const f = fixture();
  try {
    let release!: () => void;
    f.hold(() => new Promise<void>((resolve) => { release = resolve; }));
    const input = f.command(await f.observe());
    const pending = f.service.execute(f.grant.token, input);
    f.service.takeoverTab(f.session.primaryTabId);
    release();
    assert.equal((await pending).status, "uncertain");
    assert.throws(() => f.service.resume(f.grant.token, f.session.id), /Fresh observation/);
    assert.equal((await f.service.execute(f.grant.token, f.command({ revision: 0 }))).code, "HUMAN_CONTROL");
    await f.observe();
    assert.equal(f.service.resume(f.grant.token, f.session.id).controller, "agent");
  } finally { f.service.dispose(); }
});
test("in-flight exact retries return pending uncertainty and never execute twice", async () => {
  const f = fixture();
  try {
    let release!: () => void;
    f.hold(() => new Promise<void>((resolve) => { release = resolve; }));
    const input = f.command(await f.observe());
    const pending = f.service.execute(f.grant.token, input);
    const retry = await f.service.execute(f.grant.token, input);
    assert.equal(retry.status, "uncertain"); assert.equal(retry.code, "ACTION_PENDING");
    release(); await pending; assert.equal(f.count(), 1);
  } finally { f.service.dispose(); }
});
test("revoke/expiry reject requests without exposing the token", async () => {
  let clock = 10000;
  const f = fixture({ now: () => clock });
  try {
    const summaries = JSON.stringify(f.service.listGrants());
    assert.equal(summaries.includes(f.grant.token), false);
    clock += 3600001;
    await assert.rejects(f.observe(), /pairing/);
    assert.equal(f.service.isTabAgentControlled(f.session.primaryTabId), false);
  } finally { f.service.dispose(); }
});
test("capability scopes and foreign workspace grants fail closed", async () => {
  const f = fixture();
  try {
    const other = f.service.createGrant({ actorId: "outsider", workspaceIds: ["private"], capabilities: ["observe", "tabs"] });
    await assert.rejects(f.service.execute(other.token, f.command(f.session)), /not authorized/);
    const readonly = f.service.createGrant({ actorId: "agent", workspaceIds: ["work"], capabilities: ["observe"] });
    f.service.bindGrantToSession(readonly.grantId, f.session.id);
    assert.equal((await f.service.execute(readonly.token, f.command(await f.observe()))).code, "CAPABILITY_DENIED");
  } finally { f.service.dispose(); }
});
test("a conversation-bound grant cannot address a sibling session", async () => {
  const f = fixture();
  try {
    const sibling = f.service.createSession(f.grant.token, { requestId: "sibling", workspaceId: "work", conversationId: "other" });
    f.service.bindGrantToSession(f.grant.grantId, f.session.id);
    await assert.rejects(f.service.execute(f.grant.token, { version: 1, requestId: "status", action: "session.status", sessionId: sibling.id }), /not authorized/);
    assert.throws(() => f.service.createSession(f.grant.token, { requestId: "another", workspaceId: "work", conversationId: "other" }), /another conversation/);
  } finally { f.service.dispose(); }
});
test("whole-target auth protection suppresses observations and input", async () => {
  let protectedTarget = false;
  const f = fixture({ protected: () => protectedTarget });
  try {
    const before = await f.observe(); protectedTarget = true;
    assert.equal((await f.observe()).code, "AUTHENTICATION_PROTECTED");
    assert.equal((await f.service.execute(f.grant.token, f.command(before))).code, "AUTHENTICATION_PROTECTED");
    assert.equal(f.count(), 0);
  } finally { f.service.dispose(); }
});
test("unavailable authentication cannot masquerade as successful fill", async () => {
  const f = fixture();
  try {
    f.views.get(f.session.primaryTabId)!.url = "https://example.test/login";
    const observed = await f.observe();
    const result = await f.service.execute(f.grant.token, { version: 1, requestId: "auth", sessionId: f.session.id, tabId: f.session.primaryTabId, expectedRevision: observed.revision, action: "authenticate", origin: "https://example.test" });
    assert.equal(result.status, "failed"); assert.equal(result.code, "AUTH_PROVIDER_UNAVAILABLE");
  } finally { f.service.dispose(); }
});
test("activity events correlate actual execution, not rejected requests or chat visibility", async () => {
  const f = fixture();
  try {
    const events: { type: string; active?: boolean; requestId?: string }[] = [];
    f.service.subscribe((event) => events.push(event));
    await f.service.execute(f.grant.token, f.command(f.session));
    assert.equal(events.length, 0);
    const observation = await f.observe("read");
    await f.service.execute(f.grant.token, f.command(observation, { requestId: "write" }));
    assert.deepEqual(events.filter((event) => event.type === "activity").map((event) => [event.requestId, event.active]), [["read", true], ["read", false], ["write", true], ["write", false]]);
    const page = f.service.events(f.grant.token);
    assert.equal(f.service.events(f.grant.token, { epoch: page.epoch, after: page.cursor }).events.length, 0);
    assert.equal(f.service.events(f.grant.token, { epoch: "old" }).resetRequired, true);
  } finally { f.service.dispose(); }
});
test("persisted journal contains no token, input text, or page observations and restores fenced", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zenmium-control-unit-")), stateFile = join(dir, "control.json");
  const f = fixture({ stateFile });
  let restored: InstanceType<typeof BrowserControlService> | undefined;
  try {
    const observation = await f.observe();
    const input = { ...f.command(observation), action: "fill", text: "private submitted fixture text" };
    const first = await f.service.execute(f.grant.token, input);
    f.service.dispose();
    const raw = readFileSync(stateFile, "utf8");
    for (const forbidden of [f.grant.token, "private submitted fixture text", "Safe text"]) assert.equal(raw.includes(forbidden), false);
    restored = new BrowserControlService(f.core, { stateFile });
    assert.equal(restored.getSessionForTab(f.session.primaryTabId)?.controller, "human");
    assert.throws(() => restored!.validateToken(f.grant.token), /pairing/);
    const replacement = restored.createGrant({ actorId: "agent", workspaceIds: ["work"], capabilities: ["observe", "tabs", "interact"] });
    restored.bindGrantToSession(replacement.grantId, f.session.id);
    assert.deepEqual(await restored.execute(replacement.token, input), first);
  } finally { restored?.dispose(); f.service.dispose(); rmSync(dir, { recursive: true, force: true }); }
});
test("secret-bearing URLs, text and unsafe command shapes are not exposed", () => {
  const basicAuthUrl = ["https://name:", "secret@example.test/path?token=secret#otp"].join("");
  assert.equal(safeControlUrl(basicAuthUrl), "https://example.test/path");
  assert.equal(redactControlText("password=hidden verification code: 123456"), "[redacted] [redacted]");
  const unsafeAuthUrl = ["https://user:", "pass@example.test/"].join("");
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", unsafeAuthUrl]) assert.equal(browserControlCommandSchema.safeParse({ version: 1, requestId: "r", sessionId: "s", tabId: "t", expectedRevision: 0, action: "navigate", url }).success, false);
  assert.equal(browserControlCommandSchema.safeParse({ version: 1, requestId: "r", sessionId: "s", tabId: "t", expectedRevision: 0, action: "cdp", method: "Network.getAllCookies", params: {} }).success, false);
});
test("local MCP client conformance: native session, observe, mutation, replay, authenticated events", async () => {
  const f = fixture();
  const bridge = await startBrowserControlBridge(f.service);
  try {
    f.service.bindGrantToSession(f.grant.grantId, f.session.id);
    const client = new BrowserControlClient({ url: bridge.url, token: f.grant.token });
    await client.initialize();
    assert.equal((await client.capabilities()).interactiveNativeSession, true);
    const session = await client.createSession({ requestId: "host-start", workspaceId: "work", conversationId: "chat" });
    assert.equal(session.id, f.session.id);
    const read = await client.execute({ version: 1, requestId: "host-observe", sessionId: session.id, tabId: session.primaryTabId, action: "observe" });
    const input = f.command(read, { requestId: "host-click" });
    const first = await client.execute(input);
    assert.deepEqual(await client.execute(input), first); assert.equal(f.count(), 1);
    assert.ok((await client.events()).cursor > 0);
    f.service.revokeGrant(f.grant.grantId);
    await assert.rejects(client.capabilities(), /401/);
  } finally { await bridge.close(); f.service.dispose(); }
});
test("loopback bridge rejects web origins, wrong Host, missing pairing, and raw debug routes", async () => {
  const f = fixture(), bridge = await startBrowserControlBridge(f.service);
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = { Authorization: `Bearer ${f.grant.token}`, "Content-Type": "application/json" };
    assert.equal((await fetch(bridge.url, { method: "POST", headers: { ...headers, Origin: "https://evil.test" }, body })).status, 403);
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(bridge.url, { method: "POST", headers: { ...headers, Host: "evil.test" } }, (response) => { response.resume(); resolve(response.statusCode!); });
      request.on("error", reject); request.end(body);
    });
    assert.equal(wrongHost, 403);
    assert.equal((await fetch(bridge.url, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status, 401);
    assert.equal((await fetch(bridge.url.replace("/mcp", "/json/list"), { headers })).status, 404);
  } finally { await bridge.close(); f.service.dispose(); }
});
