// background.js — the component extension's service worker.
//
// One half of the ported v1 contract (the other half is zenmiumd). This is
// the executor the daemon's control.Driver drives: it owns the native
// messaging port to zenmium-control-host, binds this Chromium profile to a
// Zenmium workspace, dispatches exec requests into pages via domControl,
// watches navigation (the v1 watch() port), surfaces pairing consent, and
// relays the agent rail between the dock and the daemon.
//
// Credential boundary (protected zones):
//   - never sends page text/URLs with credentials; all URLs pass safeUrl()
//   - never forwards observation payloads on auth surfaces
//   - never logs secrets; fill values go into the page and do not come back

import { domControl } from "./dom-control.js";

const HOST = "io.zenmium.control";

// ---- profile<->workspace binding -----------------------------------------
// The nonce in chrome.storage.local is profile-scoped: it binds THIS
// profile's native connection to a workspace record in the daemon. A second
// profile cannot replay it (storage.local is per-profile).

async function getNonce() {
  const { controlNonce } = await chrome.storage.local.get("controlNonce");
  if (controlNonce) return controlNonce;
  const nonce = crypto.randomUUID();
  await chrome.storage.local.set({ controlNonce: nonce });
  return nonce;
}

let port = null;
let boundWorkspaceId = null;
let reconnectDelay = 500;

function connect() {
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    scheduleReconnect();
    return;
  }
  port.onMessage.addListener(onDaemonMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    boundWorkspaceId = null;
    scheduleReconnect();
  });
  getNonce().then((nonce) => {
    send({
      kind: "hello",
      nonce,
      profileId: profileHint(),
      profileName: profileHint(),
    });
  });
}

// Chromium does not expose the profile directory name to extensions; the
// daemon's nonce binding IS the mapping. The hint is informational only.
function profileHint() {
  return chrome.runtime.getManifest().name + " profile";
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 15000);
}

function send(msg) {
  if (!port) return;
  try {
    port.postMessage(msg);
  } catch (e) {
    /* port died; onDisconnect will schedule reconnect */
  }
}

// ---- session scope state ---------------------------------------------------
// sessionId -> { tabId } — the one-tab policy: a session binds to exactly
// one tab, chosen by tab.create/tab.adopt or the first navigate.
const sessionTabs = new Map();

function sessionTab(sessionId) {
  return sessionTabs.get(sessionId)?.tabId ?? null;
}

function bindTab(sessionId, tabId) {
  sessionTabs.set(sessionId, { tabId });
}

// ---- watchers (the v1 watch() port) ----------------------------------------
// Navigation on a bound tab bumps the daemon's session revision and raises
// the needs-observation gate.

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading" || !changeInfo.url) return;
  for (const [sessionId, s] of sessionTabs) {
    if (s.tabId === tabId) {
      send({ kind: "watched", sessionId, url: safeUrl(changeInfo.url), tabId });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [sessionId, s] of sessionTabs) {
    if (s.tabId === tabId) {
      send({ kind: "watched", sessionId, url: "", tabId });
      sessionTabs.delete(sessionId);
    }
  }
});

function safeUrl(raw) {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/[A-Za-z0-9_\-.]{48,}/g, "[redacted]");
    return `${u.origin}${path}`;
  } catch {
    return "";
  }
}

// ---- exec dispatch ----------------------------------------------------------

async function onDaemonMessage(msg) {
  switch (msg.kind) {
    case "bound":
      boundWorkspaceId = msg.workspaceId;
      reconnectDelay = 500;
      break;
    case "exec":
      runExec(msg);
      break;
    case "pair.request":
      openConsent(msg);
      break;
    case "chat.event":
      relayToDock({ type: "chat.event", payload: msg.payload });
      break;
    case "auth.request":
      relayToDock({ type: "auth.request", payload: msg.payload });
      break;
  }
}

async function runExec(msg) {
  const { id, sessionId, command } = msg;
  const args = msg.args || {};
  try {
    const result = await dispatch(sessionId, command, args);
    send({ kind: "exec.result", id, sessionId, ok: true, result });
  } catch (e) {
    send({
      kind: "exec.result", id, sessionId, ok: false,
      code: e.code || "NATIVE_ACTION_FAILED",
      message: String(e.message || e),
      uncertain: !!e.uncertain,
    });
  }
}

const cmdError = (code, message, uncertain = false) => {
  const e = new Error(message);
  e.code = code;
  e.uncertain = uncertain;
  return e;
};

async function dispatch(sessionId, command, args) {
  switch (command) {
    case "observe": {
      const tab = await boundTabFor(sessionId);
      return injectObserve(tab.id, args);
    }
    case "session.status": {
      const tab = sessionTab(sessionId) != null ? await chrome.tabs.get(sessionTab(sessionId)).catch(() => null) : null;
      return { tabId: tab?.id ?? null, url: tab ? safeUrl(tab.url || "") : "", title: tab?.title || "" };
    }
    case "navigate": {
      const tab = await boundTabFor(sessionId, args.url);
      await chrome.tabs.update(tab.id, { url: args.url });
      return { url: safeUrl(args.url) };
    }
    case "tab.create": {
      const t = await chrome.tabs.create({ url: args.url || "about:blank", active: true });
      enforceOneTab(sessionId, t.id);
      return { tabId: t.id, url: safeUrl(t.url || "") };
    }
    case "tab.adopt": {
      const t = await chrome.tabs.get(args.tabId);
      if (!t) throw cmdError("TAB_OUT_OF_SCOPE", "tab not found");
      enforceOneTab(sessionId, t.id);
      return { tabId: t.id, url: safeUrl(t.url || "") };
    }
    case "tab.close": {
      const cur = sessionTab(sessionId);
      const target = args.tabId ?? cur;
      if (target == null) throw cmdError("TARGET_UNAVAILABLE", "no bound tab");
      await chrome.tabs.remove(target);
      if (target === cur) sessionTabs.delete(sessionId);
      return {};
    }
    case "click": case "fill": case "press": case "scroll": {
      const tab = await boundTabFor(sessionId);
      return injectAction(tab.id, command, args, args.documentId);
    }
    case "download": {
      const tab = await boundTabFor(sessionId);
      const url = args.url || tab.url;
      if (!url) throw cmdError("INVALID_REQUEST", "no url");
      const item = await chrome.downloads.download({ url });
      return { downloadId: item, url: safeUrl(url) };
    }
    case "authenticate": {
      // Routes to the auth broker surface (pairing.html handles consent);
      // the 1Password lane is documented in internal/docs/ONEPASSWORD-LANE.md.
      const tab = await boundTabFor(sessionId);
      return { authenticationRequired: true, url: safeUrl(tab.url || "") };
    }
    case "cdp": {
      // v1 cdp is constrained to Page.navigate; anything else is refused.
      if (args.method !== "Page.navigate") {
        throw cmdError("CAPABILITY_DENIED", `cdp method ${args.method} not allowed (Page.navigate only)`);
      }
      const tab = await boundTabFor(sessionId);
      await chrome.tabs.update(tab.id, { url: args.params?.url });
      return { url: safeUrl(args.params?.url || "") };
    }
    case "cdp.target": {
      const tabs = await chrome.tabs.query({});
      return {
        targets: tabs.map((t) => ({ id: t.id, type: "page", url: safeUrl(t.url || ""), title: t.title || "" })),
      };
    }
    default:
      throw cmdError("INVALID_COMMAND", `unknown command ${command}`);
  }
}

// boundTabFor resolves the session's bound tab; on first use it binds to the
// active tab (v1: session requires a tab assignment before acting).
async function boundTabFor(sessionId, navigateUrl) {
  let tabId = sessionTab(sessionId);
  if (tabId == null) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active) throw cmdError("TARGET_UNAVAILABLE", "no active tab to bind");
    enforceOneTab(sessionId, active.id);
    tabId = active.id;
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw cmdError("TARGET_UNAVAILABLE", "bound tab is gone");
  return tab;
}

function enforceOneTab(sessionId, tabId) {
  const cur = sessionTab(sessionId);
  if (cur != null && cur !== tabId) {
    throw cmdError("ONE_TAB_POLICY", `session already bound to tab ${cur}`);
  }
  bindTab(sessionId, tabId);
}

async function injectObserve(tabId, args) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: domControl,
    args: ["observe", args || {}, null],
  });
  return sanitize(result);
}

async function injectAction(tabId, op, args, expectedDocId) {
  const expected = expectedDocId ? { documentId: expectedDocId } : null;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: domControl,
    args: [op, args || {}, expected],
  });
  if (result && result.ok === false) {
    const e = cmdError(result.code || "NATIVE_ACTION_FAILED", result.message || "action failed", !!result.uncertain);
    e.result = result;
    throw e;
  }
  return sanitize(result);
}

// sanitize strips anything the executor must never hand back: raw URLs get
// the safeUrl treatment and observation text is credential-redacted.
function sanitize(result) {
  if (!result || typeof result !== "object") return result;
  const out = { ...result };
  if (out.url) out.url = safeUrl(out.url);
  if (out.text) out.text = redactText(out.text);
  if (Array.isArray(out.elements)) {
    for (const el of out.elements) {
      if (el.name) el.name = redactText(el.name);
    }
  }
  return out;
}

const REDACT_RE = /(bearer\s+\S+|sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b\d{6,19}\b|(?:token|secret|password|otp)\s*[:=]\s*\S+)/gi;
function redactText(s) {
  return s.replace(REDACT_RE, "[redacted]");
}

// ---- pairing consent --------------------------------------------------------

let consentWindowId = null;

async function openConsent(msg) {
  const url = `pairing/pairing.html?pairId=${encodeURIComponent(msg.pairId)}&label=${encodeURIComponent(msg.label || "")}&caps=${encodeURIComponent((msg.capabilities || []).join(","))}&ttl=${msg.ttlSeconds || 0}`;
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(url),
    type: "popup",
    width: 460,
    height: 520,
    focused: true,
  });
  consentWindowId = win.id;
}

// Consent responses arrive on a runtime channel from pairing.js.
chrome.runtime.onMessage.addListener((m, _sender, respond) => {
  if (m?.type === "pair.respond") {
    send({ kind: "pair.respond", pairId: m.pairId, approve: !!m.approve });
    if (consentWindowId) chrome.windows.remove(consentWindowId).catch(() => {});
    consentWindowId = null;
    respond({ ok: true });
    return true;
  }
  if (m?.type === "chat.send" || m?.type === "chat.abort" || m?.type === "chat.approve" || m?.type === "dock.state") {
    send({ kind: m.type, payload: m.payload });
    respond({ ok: true });
    return true;
  }
  if (m?.type === "dock.query") {
    respond({ bound: !!boundWorkspaceId, workspaceId: boundWorkspaceId });
    return true;
  }
});

// ---- dock relay --------------------------------------------------------------
// The dock page opens a long-lived runtime port; daemon chat/auth events are
// pushed to it. MV3 forbids persistent ports being required — the dock
// re-opens on reconnect.

const dockPorts = new Set();
chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== "dock") return;
  dockPorts.add(p);
  p.onDisconnect.addListener(() => dockPorts.delete(p));
});

function relayToDock(msg) {
  for (const p of dockPorts) {
    try {
      p.postMessage(msg);
    } catch {
      dockPorts.delete(p);
    }
  }
}

// ---- side panel --------------------------------------------------------------
// T2 seam: the toolbar/action entry point lives in T2's chrome patches. The
// extension declares the panel; T2's surfaces call sidePanel.open() or the
// user picks "Zenmium Assistant" from the side-panel switcher. The action
// click opens the panel where a button exists.

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

// Keepalive: MV3 workers idle-terminate; the native port dies with them.
// The 25s alarm re-arms the worker — the port re-opens on wakeup.
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "keepalive" && !port) connect();
});

connect();
