import assert from "node:assert/strict";
import test from "node:test";
import { AuthenticationBroker, type AuthenticationScope, type AuthenticationSnapshot } from "../src/main/authentication-broker.ts";
const scope: AuthenticationScope = { actorId: "actor", workspaceId: "workspace", profileId: "profile", agentSessionId: "session", tabId: "tab", origin: "https://fixture.invalid" };
test("no provider means unavailable, never simulated login", async () => {
  const broker = new AuthenticationBroker({ isCurrentTarget: () => true });
  const request = await broker.request(scope);
  assert.equal(request.status, "unavailable"); assert.equal(request.includeTotp, true);
  assert.equal(broker.isProtectedTarget(scope.profileId, scope.tabId), false); broker.dispose();
});
test("trusted acknowledgement includes TOTP by default; fixed statuses contain no provider data", async () => {
  let called = false;
  const events: AuthenticationSnapshot[] = [];
  const broker = new AuthenticationBroker({ isCurrentTarget: () => true, provider: {
    available: async () => true,
    authenticate: async (_scope, options) => { called = true; assert.equal(options.includeTotp, true); options.progress("awaiting-totp"); return "authenticated"; },
  } });
  broker.subscribe(event => events.push(event));
  const request = await broker.request({ ...scope, password: "do-not-propagate" } as AuthenticationScope);
  assert.equal(request.status, "awaiting-consent"); assert.equal(called, false);
  assert.equal(broker.isProtectedTarget(scope.profileId, scope.tabId), true);
  const result = await broker.acknowledge(request.requestId, scope);
  assert.equal(result.status, "authenticated"); assert.equal(called, true);
  assert.equal(JSON.stringify(events).includes("do-not-propagate"), false);
  assert.equal(broker.isProtectedTarget(scope.profileId, scope.tabId), false); broker.dispose();
});
test("origin/session mismatch cannot read, cancel, or acknowledge another login", async () => {
  const broker = new AuthenticationBroker({ isCurrentTarget: () => true, provider: { available: async () => true, authenticate: async () => "authenticated" } });
  const request = await broker.request(scope), other = { ...scope, agentSessionId: "other" };
  assert.equal(broker.get(request.requestId, other), undefined); assert.equal(broker.cancel(request.requestId, other), undefined);
  await assert.rejects(broker.acknowledge(request.requestId, other));
  await assert.rejects(broker.request({ ...scope, origin: "https://fixture.invalid/?token=secret" }));
  await assert.rejects(broker.request({ ...scope, origin: "http://fixture.invalid" })); broker.dispose();
});
test("takeover cancels in-flight work and late provider success cannot revive it", async () => {
  let complete!: (value: "authenticated") => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let signal: AbortSignal | undefined;
  const broker = new AuthenticationBroker({ isCurrentTarget: () => true, provider: { available: async () => true,
    authenticate: async (_scope, options) => { signal = options.signal; started(); return new Promise(resolve => { complete = resolve; }); },
  } });
  const request = await broker.request(scope), result = broker.acknowledge(request.requestId, scope);
  await ready; broker.cancelForSession(scope.agentSessionId); assert.equal(signal?.aborted, true);
  complete("authenticated"); assert.equal((await result).status, "cancelled"); broker.dispose();
});
test("stale target and expired consent never reach provider", async () => {
  let now = 0, current = true, calls = 0;
  const broker = new AuthenticationBroker({ now: () => now, timeoutMs: 1000, isCurrentTarget: () => current,
    provider: { available: async () => true, authenticate: async () => { calls++; return "authenticated"; } },
  });
  const request = await broker.request(scope); now = 1001;
  assert.equal((await broker.acknowledge(request.requestId, scope)).status, "expired");
  const next = await broker.request(scope); current = false;
  assert.equal((await broker.acknowledge(next.requestId, scope)).status, "cancelled");
  assert.equal(calls, 0); broker.dispose();
});
test("provider errors never leak diagnostic strings or secrets", async () => {
  const broker = new AuthenticationBroker({ isCurrentTarget: () => true, provider: { available: async () => true,
    authenticate: async () => { throw new Error("password=secret otp=123456"); },
  } });
  const request = await broker.request(scope), result = await broker.acknowledge(request.requestId, scope);
  assert.equal(result.status, "failed"); assert.equal(JSON.stringify(result).includes("secret"), false); broker.dispose();
});
