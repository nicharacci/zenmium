/**
 * Real Chromium/ArcCore integration, with no BrowserChrome or renderer UI.
 * Build: node scripts/build-native-tests.mjs
 * Hidden hosts and an isolated profile; never show/focus a host window:
 * env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron out/verify/native-tests.js
 * Every run creates and retains its own printed mkdtemp userData directory.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { DownloadItem, WebContents } from "electron";
import { app, BrowserWindow, session, WebContentsView } from "electron";
import { ArcCore } from "../src/main/arc-core.ts";
import { BrowserDownloads } from "../src/main/browser-downloads.ts";
import type { DownloadRecord } from "../src/shared/browser-ui.ts";
import type { ArcState, Tab } from "../src/shared/ipc.ts";
import { getPaneTabIds } from "../src/shared/ipc.ts";

const userData = mkdtempSync(join(tmpdir(), "zenmium-native-core-"));
app.setPath("userData", userData);
app.setPath("sessionData", mkdtempSync(join(userData, "session-")));
app.setPath("crashDumps", mkdtempSync(join(userData, "crashes-")));
app.commandLine.appendSwitch("disable-background-networking");
app.on("window-all-closed", () => {
  /* Cases create and destroy hidden windows sequentially. */
});
console.log(`[native-core] isolated userData retained at ${userData}`);

const requests = new Map<string, number>();
// Generated PCM, not a remote audio asset. Short, low-volume tone; the page loops it.
const sampleRate = 8000,
  sampleCount = sampleRate / 4;
const wav = Buffer.alloc(44 + sampleCount * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(sampleCount * 2, 40);
for (let index = 0; index < sampleCount; index++)
  wav.writeInt16LE(
    Math.round(3277 * Math.sin((2 * Math.PI * 440 * index) / sampleRate)),
    44 + index * 2
  );
const downloadPayload = Buffer.from(
  "Zenmium isolated native download fixture.\n".repeat(1024)
);
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
  requests.set(path, (requests.get(path) ?? 0) + 1);
  // Deliberately never commit a document; the test cancels the navigation.
  if (path.startsWith("/slow/")) return;
  // A network failure, not an HTTP 404 (which is still a committed document).
  if (path.startsWith("/error/")) {
    response.destroy();
    return;
  }
  if (path === "/redirect") {
    response.writeHead(302, { Location: "/page/redirected" });
    response.end();
    return;
  }
  if (path === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (path === "/tone.wav") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": wav.length,
      "Content-Type": "audio/wav",
    });
    response.end(wav);
    return;
  }
  if (path === "/downloads/complete") {
    response.writeHead(200, {
      "Content-Disposition": 'attachment; filename="native-complete.bin"',
      "Content-Length": downloadPayload.length,
      "Content-Type": "application/octet-stream",
    });
    response.end(downloadPayload);
    return;
  }
  if (path === "/downloads/slow") {
    const total = 8 * 1024 * 1024;
    const range = /^bytes=(\d+)-/.exec(request.headers.range ?? "");
    let sent = range ? Number(range[1]) : 0;
    if (sent >= total) {
      response.writeHead(416);
      response.end();
      return;
    }
    response.writeHead(range ? 206 : 200, {
      "Accept-Ranges": "bytes",
      "Content-Disposition": 'attachment; filename="native-slow.bin"',
      "Content-Length": total - sent,
      "Content-Type": "application/octet-stream",
      ...(range
        ? { "Content-Range": `bytes ${sent}-${total - 1}/${total}` }
        : {}),
    });
    const send = () => {
      const size = Math.min(32 * 1024, total - sent);
      response.write(Buffer.alloc(size, 90));
      sent += size;
      if (sent === total) {
        clearInterval(timer);
        response.end();
      }
    };
    const timer = setInterval(send, 40);
    response.once("close", () => clearInterval(timer));
    send();
    return;
  }
  const title = `Fixture ${path}`;
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>
    <h1>${title}</h1><a id="next" href="/page/linked">Next fixture</a>
    <a id="new-tab" href="/page/popup" target="_blank">New tab fixture</a>
    <button id="input-probe">Trusted input probe</button>
    <input id="unsaved-input" aria-label="Fixture unsaved input">
    ${path === "/page/audio" ? '<audio id="tone" loop preload="auto" src="/tone.wav"></audio>' : ""}`);
});

async function waitFor(
  check: () => boolean | Promise<boolean>,
  label: string,
  timeout = 10_000
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await delay(20);
  }
}

// A hidden window may not receive native input on every platform. This is an
// explicitly reported coverage limitation, never counted as a passing test.
class NativeInputUnavailable extends Error {}

async function nativeClick(
  wc: WebContents,
  elementId: string,
  alt = false
): Promise<void> {
  const point = (await wc.executeJavaScript(`(() => {
    const element = document.getElementById(${JSON.stringify(elementId)});
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`)) as { x: number; y: number };
  const modifiers: Electron.MouseInputEvent["modifiers"] = alt ? ["alt"] : [];
  wc.sendInputEvent({ type: "mouseMove", ...point, modifiers });
  wc.sendInputEvent({
    type: "mouseDown",
    ...point,
    button: "left",
    clickCount: 1,
    modifiers,
  });
  wc.sendInputEvent({
    type: "mouseUp",
    ...point,
    button: "left",
    clickCount: 1,
    modifiers,
  });
}

async function nativeFocus(wc: WebContents): Promise<void> {
  let focused = false;
  const onFocus = () => {
    focused = true;
  };
  wc.on("focus", onFocus);
  try {
    // Focus only the page within the hidden host, never BrowserWindow/app.focus.
    wc.focus();
    try {
      await waitFor(() => focused, "Chromium emits native page focus", 2000);
    } catch (error) {
      if (wc.isDestroyed()) throw error;
      throw new NativeInputUnavailable(
        "The hidden host did not emit a native page focus event. No host window was shown or focused."
      );
    }
  } finally {
    wc.off("focus", onFocus);
  }
}

interface Harness {
  core: ArcCore;
  win: BrowserWindow;
  seen: Set<WebContents>;
  directory: string;
}

function makeHarness(
  directory = mkdtempSync(join(userData, "case-")),
  configure?: (core: ArcCore) => void
): Harness {
  const win = new BrowserWindow({
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    width: 1200,
  });
  const core = new ArcCore(win, directory);
  const seen = new Set<WebContents>();
  try {
    core.setChromeCallbacks(
      () => {},
      (wc) => seen.add(wc)
    );
    configure?.(core);
    core.setContentBounds({ height: 700, width: 1000, x: 8, y: 8 });
    core.boot();
    assert.equal(
      win.isVisible(),
      false,
      "native harness must never show a window"
    );
    return { core, directory, seen, win };
  } catch (error) {
    try {
      core.dispose();
    } finally {
      win.destroy();
    }
    throw error;
  }
}

function tab(core: ArcCore, id: string): Tab {
  const result = core.snapshot().tabs.find((entry) => entry.id === id);
  assert.ok(result, `Expected tab ${id}`);
  return result;
}

function active(core: ArcCore): WebContents {
  const wc = core.getActiveWebContents();
  assert.ok(
    wc && !wc.isDestroyed(),
    "active tab must have a live Chromium WebContents"
  );
  return wc;
}

function attached(win: BrowserWindow): WebContentsView[] {
  return win.contentView.children.filter(
    (view): view is WebContentsView => view instanceof WebContentsView
  );
}

async function settled(
  core: ArcCore,
  id: string,
  wc: WebContents,
  url: string
): Promise<void> {
  await waitFor(() => {
    if (wc.isDestroyed()) return false;
    const current = tab(core, id);
    return (
      wc.getURL() === url &&
      !wc.isLoading() &&
      current.url === url &&
      !current.loading
    );
  }, `tab ${id} loaded ${url}`);
  assert.equal(tab(core, id).error ?? null, null);
}

async function open(
  core: ArcCore,
  url: string
): Promise<{ id: string; wc: WebContents }> {
  const created = core.newTab({ url });
  const wc = active(core);
  await settled(core, created.id, wc, url);
  return { id: created.id, wc };
}

// Subscribe before triggering reload/navigation, including same-URL reloads.
async function finished(wc: WebContents, action: () => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      wc.off("did-finish-load", success);
      wc.off("did-fail-load", failure);
      wc.off("destroyed", destroyed);
    };
    const success = () => {
      cleanup();
      resolve();
    };
    const destroyed = () => {
      cleanup();
      reject(new Error("WebContents destroyed before load completed"));
    };
    const failure = (
      _event: Electron.Event,
      code: number,
      description: string,
      url: string,
      mainFrame: boolean
    ) => {
      if (!mainFrame || code === -3) return;
      cleanup();
      reject(new Error(`${description} (${code}) loading ${url}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for did-finish-load"));
    }, 10_000);
    wc.once("did-finish-load", success);
    wc.on("did-fail-load", failure);
    wc.once("destroyed", destroyed);
    try {
      action();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

// ArcCore records millisecond timestamps; avoid ambiguous MRU ties, not guessed sleeps.
async function selectLatest(core: ArcCore, id: string): Promise<void> {
  const latest = Math.max(
    ...core.snapshot().tabs.map((entry) => entry.lastActiveAt)
  );
  await waitFor(() => Date.now() > latest, "a distinct MRU timestamp");
  core.activateTab(id);
}

type NativeCase = {
  name: string;
  run: (harness: Harness, url: (path: string) => string) => Promise<void>;
};
const cases: NativeCase[] = [
  {
    name: "boot is idempotent and snapshots cannot mutate live state",
    async run({ core, seen }) {
      const original = core.snapshot();
      assert.equal(original.spaces.length, 1);
      assert.equal(original.tabs.length, 1);
      assert.equal(original.tabs[0]!.url, "about:blank");
      assert.equal(
        core.getActiveWebContents(),
        undefined,
        "blank tabs need no native page"
      );
      core.boot();
      assert.deepEqual(core.snapshot(), original);
      original.tabs[0]!.title = "not a command";
      original.spaces.length = 0;
      assert.equal(core.snapshot().spaces.length, 1);
      assert.equal(core.snapshot().tabs[0]!.title, "New Tab");
      assert.equal(seen.size, 0);
    },
  },
  {
    name: "pinned navigation preserves the reset URL; editing it does not navigate until reset",
    async run({ core }, url) {
      const a = url("/page/pin-original"),
        b = url("/page/pin-away"),
        c = url("/page/pin-replacement");
      const { id, wc } = await open(core, a);
      core.pinTab(id);
      await finished(wc, () => core.navigate(id, b));
      await settled(core, id, wc, b);
      assert.equal(tab(core, id).pinnedUrl, a);
      assert.equal(tab(core, id).pinnedChanged, true);
      await finished(wc, () => core.resetTab(id));
      await settled(core, id, wc, a);
      assert.equal(tab(core, id).pinnedChanged, false);
      core.updateTab(id, { pinnedUrl: c });
      assert.equal(
        wc.getURL(),
        a,
        "editing a reset target must not navigate the page"
      );
      assert.equal(tab(core, id).pinnedUrl, c);
      assert.equal(
        tab(core, id).pinnedChanged,
        true,
        "reset affordance must reflect the newly edited target"
      );
      await finished(wc, () => core.resetTab(id));
      await settled(core, id, wc, c);
      assert.equal(tab(core, id).pinnedChanged, false);
    },
  },
  {
    name: "custom title survives real reload, link navigation and back/forward",
    async run({ core }, url) {
      const first = url("/page/title"),
        linked = url("/page/linked");
      const { id, wc } = await open(core, first);
      core.updateTab(id, { title: "  My renamed tab  " });
      await finished(wc, () => core.reload(id));
      await settled(core, id, wc, first);
      assert.equal(wc.getTitle(), "Fixture /page/title");
      assert.equal(tab(core, id).title, "My renamed tab");
      await finished(wc, () => {
        void wc.executeJavaScript(
          'document.getElementById("next").click()',
          true
        );
      });
      await settled(core, id, wc, linked);
      assert.equal(tab(core, id).title, "My renamed tab");
      const entries = wc.navigationHistory
        .getAllEntries()
        .map(({ url, title }) => ({ title, url }));
      assert.ok(
        entries.some((entry) => entry.url === first) &&
          entries.some((entry) => entry.url === linked),
        `Native navigation entries: ${JSON.stringify(entries)}`
      );
      assert.equal(
        wc.navigationHistory.canGoBack(),
        true,
        `Gesture fixture must be traversable before checking the model: ${JSON.stringify(entries)}`
      );
      assert.equal(tab(core, id).canGoBack, true);
      await finished(wc, () => core.back(id));
      await settled(core, id, wc, first);
      assert.equal(
        wc.navigationHistory.canGoForward(),
        true,
        "Chromium must have a forward entry before checking the model"
      );
      assert.equal(tab(core, id).canGoForward, true);
      await finished(wc, () => core.forward(id));
      await settled(core, id, wc, linked);
      core.updateTab(id, { customTitle: "" });
      assert.equal(tab(core, id).customTitle, undefined);
      assert.equal(tab(core, id).title, "Fixture /page/linked");
    },
  },
  {
    name: "close chooses MRU's live view and archive reopen creates a live replacement",
    async run({ core, win }, url) {
      const a = await open(core, url("/page/mru-a"));
      const b = await open(core, url("/page/mru-b"));
      const c = await open(core, url("/page/mru-c"));
      core.updateTab(c.id, { title: "Restored title" });
      await selectLatest(core, b.id);
      await selectLatest(core, a.id);
      await selectLatest(core, c.id);
      core.closeTab(c.id);
      await waitFor(
        () => c.wc.isDestroyed(),
        "closed tab WebContents destruction"
      );
      assert.equal(
        core.snapshot().activeTabId,
        a.id,
        "MRU is activation order, not tab insertion order"
      );
      assert.equal(active(core), a.wc);
      assert.deepEqual(
        attached(win).map((view) => view.webContents),
        [a.wc]
      );
      assert.equal(core.snapshot().archive[0]!.id, c.id);
      core.restoreTab(c.id);
      const reopenedId = core.snapshot().activeTabId!;
      const reopened = active(core);
      await settled(core, reopenedId, reopened, url("/page/mru-c"));
      assert.notEqual(reopenedId, c.id);
      assert.notEqual(reopened, c.wc);
      assert.equal(tab(core, reopenedId).title, "Restored title");
      assert.equal(
        core.snapshot().archive.some((entry) => entry.id === c.id),
        false
      );
      assert.deepEqual(
        attached(win).map((view) => view.webContents),
        [reopened]
      );
    },
  },
  {
    name: "mute changes real Chromium state and survives reload plus pinned discard/reactivation",
    async run({ core }, url) {
      const original = url("/page/mute-original"),
        away = url("/page/mute-away");
      const { id, wc } = await open(core, original);
      core.pinTab(id);
      assert.equal(core.getActiveWebContents()!.isAudioMuted(), false);
      core.updateTab(id, { muted: true });
      assert.equal(core.getActiveWebContents()!.isAudioMuted(), true);
      await finished(wc, () => core.reload(id));
      await settled(core, id, wc, original);
      assert.equal(core.getActiveWebContents()!.isAudioMuted(), true);
      await finished(wc, () => core.navigate(id, away));
      await settled(core, id, wc, away);
      const archiveSize = core.snapshot().archive.length;
      core.closeTab(id);
      await waitFor(
        () => wc.isDestroyed(),
        "pinned discard destroys Chromium page"
      );
      assert.equal(tab(core, id).discarded, true);
      assert.equal(tab(core, id).url, original);
      assert.equal(tab(core, id).pinnedChanged, false);
      assert.equal(
        core.snapshot().archive.length,
        archiveSize,
        "pinned close must not archive"
      );
      core.activateTab(id);
      const replacement = active(core);
      await settled(core, id, replacement, original);
      assert.notEqual(replacement, wc);
      assert.equal(tab(core, id).discarded, false);
      assert.equal(
        replacement.isAudioMuted(),
        true,
        "new WebContents inherits the stored mute state"
      );
      core.updateTab(id, { muted: false });
      assert.equal(core.getActiveWebContents()!.isAudioMuted(), false);
      assert.equal(tab(core, id).muted, false);
    },
  },
  {
    name: "real local audio drives playback indicators; mute affects Chromium without pausing playback",
    async run({ core }, url) {
      const { id, wc } = await open(core, url("/page/audio"));
      try {
        await wc.executeJavaScript(
          'document.getElementById("tone").volume = 0.2; document.getElementById("tone").play()',
          true
        );
        await waitFor(
          () => wc.isCurrentlyAudible(),
          "Chromium reports real fixture audio"
        );
        await waitFor(
          () => tab(core, id).audio === true,
          "media-started-playing updates the tab indicator"
        );
        core.updateTab(id, { muted: true });
        assert.equal(core.getActiveWebContents()!.isAudioMuted(), true);
        assert.equal(
          await wc.executeJavaScript('document.getElementById("tone").paused'),
          false,
          "mute must not pause the media element"
        );
        core.updateTab(id, { muted: false });
        assert.equal(core.getActiveWebContents()!.isAudioMuted(), false);
        await wc.executeJavaScript('document.getElementById("tone").pause()');
        await waitFor(
          () => !wc.isCurrentlyAudible() && tab(core, id).audio === false,
          "paused media clears both native audibility and the tab indicator"
        );
      } finally {
        if (!wc.isDestroyed()) {
          wc.setAudioMuted(true);
          await wc.executeJavaScript('document.getElementById("tone").pause()');
        }
      }
    },
  },
  {
    name: "isolated tab preload exposes no browser bridge and rejects synthetic Alt-click",
    async run({ core }, url) {
      assert.ok(
        existsSync(join(import.meta.dirname, "../preload/tab.cjs")),
        "Build the product tab preload before native tests"
      );
      const { wc } = await open(core, url("/page/synthetic-alt"));
      assert.deepEqual(
        await wc.executeJavaScript(
          "[typeof window.zenmium, typeof window.ipcRenderer, typeof window.require]"
        ),
        ["undefined", "undefined", "undefined"]
      );
      // Stop normal anchor navigation after the preload's earlier capture listener.
      // A broken isTrusted guard would still send IPC before this listener runs.
      const trusted = await wc.executeJavaScript(`(() => {
        document.addEventListener("click", event => event.preventDefault(), true);
        const event = new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true, button: 0 });
        document.getElementById("next").dispatchEvent(event);
        return event.isTrusted;
      })()`);
      assert.equal(trusted, false);
      await delay(100); // Observe asynchronous IPC; rejection must leave no Glance.
      assert.equal(core.snapshot().glance, null);
      assert.equal(wc.getURL(), url("/page/synthetic-alt"));
    },
  },
  {
    name: "trusted native Alt-click opens Glance through the tab preload without navigating its parent",
    async run({ core, win, seen }, url) {
      assert.ok(
        existsSync(join(import.meta.dirname, "../preload/tab.cjs")),
        "Build the product tab preload before native tests"
      );
      const parent = url("/page/native-alt");
      const { id, wc } = await open(core, parent);
      await wc.executeJavaScript(`
        window.fixtureTrustedProbe = false;
        document.addEventListener("click", event => {
          if (event.target.id === "input-probe") window.fixtureTrustedProbe = event.isTrusted;
          event.preventDefault();
        }, true);
      `);
      await nativeClick(wc, "input-probe");
      try {
        await waitFor(
          async () =>
            await wc.executeJavaScript("window.fixtureTrustedProbe === true"),
          "hidden window receives a trusted control click",
          2000
        );
      } catch (error) {
        if (wc.isDestroyed()) throw error;
        throw new NativeInputUnavailable(
          "Hidden host did not receive a trusted control click; Electron requires host focus. No window was shown or focused. Main must cover native Alt-click in UI verification."
        );
      }
      const tabCount = core.snapshot().tabs.length;
      await nativeClick(wc, "next", true);
      await waitFor(
        () => core.snapshot().glance?.url === url("/page/linked"),
        "trusted Alt-click reaches browser:glance-link and opens Glance"
      );
      core.setPeekBounds({ height: 500, width: 700, x: 100, y: 100 });
      core.raisePeek();
      await waitFor(
        () =>
          [...seen].some(
            (page) =>
              page !== wc &&
              !page.isDestroyed() &&
              page.getURL() === url("/page/linked") &&
              !page.isLoading()
          ),
        "native Glance document loads"
      );
      assert.equal(core.snapshot().activeTabId, id);
      assert.equal(core.snapshot().tabs.length, tabCount);
      assert.equal(wc.getURL(), parent);
      assert.equal(win.isVisible(), false);
      const glance = [...seen].find((page) => page !== wc)!;
      core.closePeek();
      await waitFor(
        () => glance.isDestroyed(),
        "Glance close destroys its native page"
      );
      assert.equal(core.snapshot().glance, null);
      assert.equal(active(core), wc);
    },
  },
  {
    name: "real downloads record completed bytes, pause/resume/cancel and persist without a save dialog",
    async run({ core, directory }, url) {
      const { wc } = await open(core, url("/page/downloads"));
      const liveItems = new Set<DownloadItem>();
      let sequence = 0,
        changes = 0;
      const configure = (_event: Electron.Event, item: DownloadItem) => {
        item.setSavePath(join(directory, `fixture-download-${++sequence}.bin`));
        liveItems.add(item);
        item.once("done", () => liveItems.delete(item));
      };
      // Set the path before BrowserDownloads reads it; this suppresses the dialog.
      wc.session.prependListener("will-download", configure);
      const downloads = new BrowserDownloads(directory, () => {
        changes++;
      });
      downloads.attach(core.getProfileId(core.snapshot().activeSpaceId), core.snapshot().activeSpaceId, wc.session);
      const record = (target: string): DownloadRecord => {
        const value = downloads.list().find((entry) => entry.url === target);
        assert.ok(value, `Missing DownloadRecord for ${target}`);
        return value;
      };
      try {
        const complete = url("/downloads/complete");
        wc.downloadURL(complete);
        await waitFor(
          () =>
            downloads
              .list()
              .some(
                (entry) => entry.url === complete && entry.state === "completed"
              ),
          "native download completes"
        );
        const completed = record(complete);
        assert.equal(completed.filename, "native-complete.bin");
        assert.equal(completed.received, downloadPayload.length);
        assert.equal(completed.total, downloadPayload.length);
        assert.equal(completed.path, join(directory, "fixture-download-1.bin"));
        assert.deepEqual(readFileSync(completed.path), downloadPayload);
        assert.ok(completed.startedAt > 0);
        const copy = downloads.list();
        copy[0]!.filename = "external mutation";
        assert.equal(record(complete).filename, "native-complete.bin");

        const slow = url("/downloads/slow");
        wc.downloadURL(slow);
        await waitFor(
          () =>
            downloads
              .list()
              .some(
                (entry) =>
                  entry.url === slow &&
                  entry.state === "progressing" &&
                  entry.received > 0
              ),
          "streaming download makes progress"
        );
        const slowId = record(slow).id;
        await downloads.action(slowId, "pause");
        await waitFor(
          () => record(slow).paused,
          "paused DownloadRecord mirrors DownloadItem"
        );
        assert.ok(
          [...liveItems].some((item) => item.isPaused()),
          "pause must affect the real native download"
        );
        await waitFor(
          () => [...liveItems].some((item) => item.canResume()),
          "paused item becomes resumable"
        );
        const received = record(slow).received;
        await downloads.action(slowId, "resume");
        await waitFor(
          () => !record(slow).paused && record(slow).received > received,
          "resumed native download advances received bytes"
        );
        await downloads.action(slowId, "cancel");
        await waitFor(
          () => record(slow).state === "cancelled" && liveItems.size === 0,
          "cancelled DownloadRecord settles"
        );
        assert.ok(record(slow).received < record(slow).total);
        await assert.rejects(
          downloads.action("missing-download", "cancel"),
          /Download not found/
        );
        await assert.rejects(
          downloads.action(completed.id, "pause"),
          /unavailable/
        );
        assert.ok(changes > 0, "download mutations must notify subscribers");
        downloads.dispose();
        const restored = new BrowserDownloads(directory, () => {});
        try {
          assert.deepEqual(
            restored.list(),
            downloads.list(),
            "terminal DownloadRecords must survive a fresh manager reading disk"
          );
        } finally {
          restored.dispose();
        }
      } finally {
        try {
          for (const item of liveItems) item.cancel();
          await waitFor(() => liveItems.size === 0, "fixture download cleanup");
        } finally {
          downloads.dispose();
          wc.session.off("will-download", configure);
        }
      }
    },
  },
  {
    name: "folder and workspace commands preserve ownership while essentials overflow eight slots",
    async run({ core }) {
      const firstSpace = core.snapshot().activeSpaceId;
      const secondSpace = core.createSpace("Second").id;
      const folder = core.createFolder(firstSpace, "  Research  ");
      assert.equal(folder.name, "Research");
      assert.throws(
        () => core.createFolder("missing", "No"),
        /Workspace not found/
      );
      const foreign = core.newTab({ spaceId: secondSpace });
      const beforeForeign = core.snapshot();
      assert.throws(
        () => core.moveToFolder(foreign.id, folder.id),
        /Folder not found/
      );
      assert.deepEqual(core.snapshot(), beforeForeign);
      core.moveTabToSpace(foreign.id, "missing");
      assert.deepEqual(core.snapshot(), beforeForeign);
      core.activateSpace(firstSpace);
      for (let index = 0; index < 8; index++) core.newTab({ kind: "pinned" });
      const extra = core.newTab();
      core.pinTab(extra.id);
      assert.equal(tab(core, extra.id).kind, "pinned");
      // Folder pins do not consume one of the 8 standalone Essential slots.
      core.moveToFolder(extra.id, folder.id);
      assert.equal(tab(core, extra.id).kind, "pinned");
      assert.equal(tab(core, extra.id).folderId, folder.id);
      core.moveToFolder(extra.id, null);
      assert.equal(tab(core, extra.id).folderId, null);
      core.pinTab(foreign.id);
      assert.equal(core.moveTabToSpace(foreign.id, firstSpace).status, "moved");
      assert.equal(tab(core, foreign.id).spaceId, firstSpace);
      core.moveToFolder(extra.id, folder.id);
      core.deleteFolder(folder.id);
      assert.equal(tab(core, extra.id).kind, "today");
      assert.equal(tab(core, extra.id).folderId, null);
      assert.equal(tab(core, extra.id).pinnedUrl, undefined);
      core.moveTabToSpace(extra.id, secondSpace);
      assert.equal(tab(core, extra.id).spaceId, secondSpace);
      assert.equal(tab(core, extra.id).folderId, null);
    },
  },
  {
    name: "creating overflow Essentials preserves every saved destination",
    async run({ core }) {
      for (let index = 0; index < 8; index++) core.newTab({ kind: "pinned" });
      const extra = core.newTab({ kind: "pinned" });
      assert.equal(core.snapshot().tabs.filter((t) => t.kind === "pinned").length, 9);
      assert.equal(tab(core, extra.id).pinnedUrl, "about:blank");
    },
  },
  {
    name: "workspace pinned-section collapse persists true, false and omitted values across core restarts",
    async run({ core, win, directory }) {
      const first = core.snapshot().activeSpaceId;
      const second = core.createSpace("Expanded pins").id;
      const legacy = core.createSpace("Unset preference").id;
      const flags = (state: ArcState) =>
        [first, second, legacy].map((id) => {
          const space = state.spaces.find((entry) => entry.id === id);
          assert.ok(space, `Persisted workspace ${id} must survive restart`);
          return space.pinnedCollapsed;
        });
      core.updateSpace(first, { pinnedCollapsed: true });
      core.updateSpace(second, { pinnedCollapsed: false });
      core.activateSpace(first);
      assert.deepEqual(flags(core.snapshot()), [true, false, undefined]);
      core.dispose();
      win.destroy();
      const saved = JSON.parse(
        readFileSync(join(directory, "zenmium/state.json"), "utf8")
      ) as ArcState;
      assert.deepEqual(
        flags(saved),
        [true, false, undefined],
        "disposal must flush both boolean values to disk"
      );

      // Fresh ArcCore/window instances read the same isolated store, not a reused snapshot.
      const restored = makeHarness(directory);
      try {
        assert.deepEqual(flags(restored.core.snapshot()), [
          true,
          false,
          undefined,
        ]);
        restored.core.updateSpace(first, { pinnedCollapsed: false });
        restored.core.updateSpace(second, { pinnedCollapsed: true });
      } finally {
        try {
          restored.core.dispose();
        } finally {
          restored.win.destroy();
        }
      }
      const restoredAgain = makeHarness(directory);
      try {
        assert.deepEqual(
          flags(restoredAgain.core.snapshot()),
          [false, true, undefined],
          "expanding a previously collapsed section must also survive restart"
        );
      } finally {
        try {
          restoredAgain.core.dispose();
        } finally {
          restoredAgain.win.destroy();
        }
      }
    },
  },
  {
    name: "workspace deletion destroys its pages/folders and cannot delete the final workspace",
    async run({ core, win }, url) {
      const firstSpace = core.snapshot().activeSpaceId;
      const survivor = await open(core, url("/page/space-survivor"));
      const doomedSpace = core.createSpace("Doomed").id;
      const folder = core.createFolder(doomedSpace, "Temporary");
      const doomed = await open(core, url("/page/space-doomed"));
      core.moveToFolder(doomed.id, folder.id);
      core.deleteSpace(doomedSpace);
      await waitFor(
        () => doomed.wc.isDestroyed(),
        "deleted workspace page destruction"
      );
      const state = core.snapshot();
      assert.equal(state.spaces.length, 1);
      assert.equal(state.activeSpaceId, firstSpace);
      assert.equal(state.activeTabId, survivor.id);
      assert.equal(
        state.tabs.some((entry) => entry.spaceId === doomedSpace),
        false
      );
      assert.equal(
        state.folders.some((entry) => entry.spaceId === doomedSpace),
        false
      );
      assert.equal(active(core), survivor.wc);
      assert.deepEqual(
        attached(win).map((view) => view.webContents),
        [survivor.wc]
      );
      core.deleteSpace(firstSpace);
      assert.deepEqual(core.snapshot(), state);
    },
  },
  {
    name: "history records committed/redirected pages once and excludes aborted and failed URLs",
    async run({ core }, url) {
      const first = url("/page/history-first"),
        next = url("/page/history-next");
      const { id, wc } = await open(core, first);
      const abortedPath = "/slow/history-aborted";
      core.navigate(id, url(abortedPath));
      await waitFor(
        () => (requests.get(abortedPath) ?? 0) > 0,
        "fixture receives the pending navigation"
      );
      await finished(wc, () => core.navigate(id, next));
      await settled(core, id, wc, next);
      assert.equal(
        core
          .snapshot()
          .history?.some((entry) => entry.url === url(abortedPath)),
        false
      );
      await finished(wc, () => core.reload(id));
      await settled(core, id, wc, next);
      assert.equal(
        core.snapshot().history?.filter((entry) => entry.url === next).length,
        1
      );
      const failed = url("/error/history-failed");
      core.navigate(id, failed);
      await waitFor(
        () => Boolean(tab(core, id).error) && !wc.isLoading(),
        "real network failure settles"
      );
      assert.equal(
        core.snapshot().history?.some((entry) => entry.url === failed),
        false
      );
      assert.equal(
        core
          .snapshot()
          .history?.some((entry) => entry.url.startsWith("chrome-error:")),
        false
      );
      await finished(wc, () => core.navigate(id, url("/redirect")));
      await settled(core, id, wc, url("/page/redirected"));
      const history = core.snapshot().history ?? [];
      assert.equal(history[0]?.url, url("/page/redirected"));
      assert.equal(
        history.some((entry) => entry.url === url("/redirect")),
        false
      );
      assert.ok(history.some((entry) => entry.url === first));
      core.clearHistory();
      assert.deepEqual(core.snapshot().history, []);
    },
  },
  {
    name: "split selection keeps native bounds/stacking stable and supports legacy snapshots",
    async run({ core, win }, url) {
      const a = await open(core, url("/page/split-a"));
      const b = await open(core, url("/page/split-b"));
      const other = await open(core, url("/page/split-other"));
      core.activateTab(a.id);
      core.toggleSplit(b.id);
      assert.equal(core.snapshot().splitTabId, b.id);
      assert.equal(core.snapshot().splitPrimaryTabId, a.id);
      const legacy = core.snapshot();
      delete legacy.splitPrimaryTabId;
      assert.deepEqual(getPaneTabIds(legacy), [a.id, b.id]);
      const panes = attached(win);
      assert.equal(panes.length, 2);
      const left = panes.find((view) => view.webContents === a.wc)!;
      const right = panes.find((view) => view.webContents === b.wc)!;
      const originalBounds = [left.getBounds(), right.getBounds()];
      assert.deepEqual(originalBounds, [
        { height: 700, width: 496, x: 8, y: 8 },
        { height: 700, width: 496, x: 512, y: 8 },
      ]);
      const parent = win.contentView;
      const add = parent.addChildView,
        remove = parent.removeChildView;
      const setBounds = panes.map((view) => view.setBounds);
      let reparents = 0;
      let resizes = 0;
      parent.addChildView = (...args) => {
        reparents++;
        return add.apply(parent, args);
      };
      parent.removeChildView = (...args) => {
        reparents++;
        return remove.apply(parent, args);
      };
      panes.forEach((view, index) => {
        view.setBounds = (bounds) => {
          resizes++;
          setBounds[index]!.call(view, bounds);
        };
      });
      try {
        for (const selected of [b, a, b, a]) {
          core.activateTab(selected.id);
          core.setContentBounds({ height: 700, width: 1000, x: 8, y: 8 });
          assert.equal(core.snapshot().activeTabId, selected.id);
          assert.equal(active(core), selected.wc);
          assert.deepEqual(getPaneTabIds(core.snapshot()), [a.id, b.id]);
          assert.deepEqual(
            [left.getBounds(), right.getBounds()],
            originalBounds
          );
          assert.deepEqual(attached(win), panes);
        }
        assert.equal(
          reparents,
          0,
          "selecting attached panes must not reparent native views"
        );
        assert.equal(
          resizes,
          0,
          "focus/layout resync with identical rectangles must not call native setBounds"
        );
      } finally {
        parent.addChildView = add;
        parent.removeChildView = remove;
        panes.forEach((view, index) => {
          view.setBounds = setBounds[index]!;
        });
      }
      // Selecting another tab replaces the focused slot, including the right slot.
      core.activateTab(b.id);
      core.activateTab(other.id);
      assert.deepEqual(getPaneTabIds(core.snapshot()), [a.id, other.id]);
      assert.deepEqual(left.getBounds(), originalBounds[0]);
      assert.deepEqual(
        attached(win)
          .find((view) => view.webContents === other.wc)!
          .getBounds(),
        originalBounds[1]
      );
      assert.equal(attached(win).includes(right), false);
      core.activateTab(a.id);
      core.activateTab(b.id);
      assert.deepEqual(getPaneTabIds(core.snapshot()), [b.id, other.id]);
      assert.deepEqual(right.getBounds(), originalBounds[0]);
      assert.equal(win.isVisible(), false);
    },
  },
  {
    name: "right split pane owns address navigation, history traversal, reload and stop",
    async run({ core, win }, url) {
      const a = await open(core, url("/page/split-nav-a"));
      const b = await open(core, url("/page/split-nav-b"));
      core.activateTab(a.id);
      core.toggleSplit(b.id);
      const panes = attached(win),
        bounds = panes.map((view) => view.getBounds());
      core.activateTab(b.id);
      const target = () => core.snapshot().activeTabId!;
      const address = url("/page/split-address");
      await finished(active(core), () => core.navigate(target(), address));
      await settled(core, b.id, b.wc, address);
      await finished(b.wc, () => {
        void b.wc.executeJavaScript(
          'document.getElementById("next").click()',
          true
        );
      });
      await settled(core, b.id, b.wc, url("/page/linked"));
      assert.equal(tab(core, target()).canGoBack, true);
      assert.equal(tab(core, a.id).canGoBack, false);
      await finished(active(core), () => core.back(target()));
      await settled(core, b.id, b.wc, address);
      assert.equal(tab(core, target()).canGoForward, true);
      await finished(active(core), () => core.forward(target()));
      await settled(core, b.id, b.wc, url("/page/linked"));
      await finished(active(core), () => core.reload(target()));
      const slow = "/slow/split-navigation";
      core.navigate(target(), url(slow));
      await waitFor(
        () => (requests.get(slow) ?? 0) > 0 && b.wc.isLoading(),
        "right pane starts pending navigation"
      );
      core.stop(target());
      await waitFor(
        () => !b.wc.isLoading() && !tab(core, b.id).loading,
        "stop settles the selected pane"
      );
      assert.equal(a.wc.getURL(), url("/page/split-nav-a"));
      assert.equal(core.snapshot().activeTabId, b.id);
      assert.deepEqual(getPaneTabIds(core.snapshot()), [a.id, b.id]);
      assert.deepEqual(attached(win), panes);
      assert.deepEqual(
        panes.map((view) => view.getBounds()),
        bounds
      );
    },
  },
  {
    name: "native page focus updates the active split pane and MRU without changing bounds",
    async run({ core, win }, url) {
      const a = await open(core, url("/page/split-focus-a"));
      const b = await open(core, url("/page/split-focus-b"));
      core.activateTab(a.id);
      core.toggleSplit(b.id);
      const panes = attached(win),
        bounds = panes.map((view) => view.getBounds());
      const before = tab(core, b.id).lastActiveAt;
      let observed: ArcState | undefined;
      const unsubscribe = core.onState((state) => {
        observed = state;
      });
      try {
        await nativeFocus(b.wc);
        assert.equal(core.snapshot().activeTabId, b.id);
        assert.equal(
          observed?.activeTabId,
          b.id,
          "chrome must receive the new command target"
        );
        assert.equal(active(core), b.wc);
        assert.ok(tab(core, b.id).lastActiveAt > before);
        assert.deepEqual(getPaneTabIds(core.snapshot()), [a.id, b.id]);
        assert.deepEqual(
          panes.map((view) => view.getBounds()),
          bounds
        );
        await nativeFocus(a.wc);
        assert.equal(core.snapshot().activeTabId, a.id);
        assert.equal(active(core), a.wc);
        assert.deepEqual(attached(win), panes);
        assert.deepEqual(
          panes.map((view) => view.getBounds()),
          bounds
        );
        assert.equal(win.isVisible(), false);
      } finally {
        unsubscribe();
      }
    },
  },
  {
    name: "trusted click in the second native pane selects it without swapping or detaching pages",
    async run({ core, win }, url) {
      const a = await open(core, url("/page/split-click-a"));
      const b = await open(core, url("/page/split-click-b"));
      core.activateTab(a.id);
      core.toggleSplit(b.id);
      const panes = attached(win),
        bounds = panes.map((view) => view.getBounds());
      await b.wc.executeJavaScript(`
        window.fixtureSplitClick = false;
        document.getElementById("input-probe").addEventListener("click", event => { window.fixtureSplitClick = event.isTrusted; });
      `);
      await nativeClick(b.wc, "input-probe");
      try {
        await waitFor(
          async () =>
            await b.wc.executeJavaScript("window.fixtureSplitClick === true"),
          "trusted click reaches the unfocused right pane",
          2000
        );
      } catch (error) {
        if (b.wc.isDestroyed()) throw error;
        throw new NativeInputUnavailable(
          "The hidden host did not deliver a trusted click to its unfocused split pane. No window was shown or focused."
        );
      }
      assert.equal(core.snapshot().activeTabId, b.id);
      assert.equal(active(core), b.wc);
      assert.deepEqual(getPaneTabIds(core.snapshot()), [a.id, b.id]);
      assert.deepEqual(attached(win), panes);
      assert.deepEqual(
        panes.map((view) => view.getBounds()),
        bounds
      );
    },
  },
  ...([0, 1] as const).flatMap((closedIndex) =>
    ([0, 1] as const).flatMap((activeIndex) =>
      [false, true].map(
        (pinned): NativeCase => ({
          name: `closing ${pinned ? "pinned" : "Today"} ${closedIndex === 0 ? "left" : "right"} pane with ${activeIndex === 0 ? "left" : "right"} selected restores its live partner`,
          async run({ core, win }, url) {
            const a = await open(core, url("/page/split-close-a"));
            const b = await open(core, url("/page/split-close-b"));
            const other = await open(core, url("/page/split-close-other"));
            const pair = [a, b],
              closed = pair[closedIndex]!,
              survivor = pair[1 - closedIndex]!;
            if (pinned) core.pinTab(closed.id);
            core.activateTab(a.id);
            core.toggleSplit(b.id);
            core.activateTab(closed.id);
            core.activateTab(other.id);
            core.activateTab(closed.id);
            core.activateTab(pair[activeIndex]!.id);
            assert.deepEqual(getPaneTabIds(core.snapshot()), [a.id, b.id]);
            if (activeIndex === closedIndex)
              assert.ok(
                tab(core, other.id).lastActiveAt >
                  tab(core, survivor.id).lastActiveAt,
                "a newer detached MRU must not displace the split partner"
              );
            core.closeTab(closed.id);
            await waitFor(
              () => closed.wc.isDestroyed(),
              "closed split page is destroyed"
            );
            assert.equal(core.snapshot().activeTabId, survivor.id);
            assert.equal(core.snapshot().splitTabId, null);
            assert.equal(core.snapshot().splitPrimaryTabId, null);
            assert.equal(active(core), survivor.wc);
            assert.deepEqual(
              attached(win).map((view) => view.webContents),
              [survivor.wc]
            );
            assert.deepEqual(attached(win)[0]!.getBounds(), {
              height: 700,
              width: 1000,
              x: 8,
              y: 8,
            });
            assert.equal(other.wc.isDestroyed(), false);
            assert.equal(
              core.snapshot().archive.some((entry) => entry.id === closed.id),
              !pinned
            );
            if (pinned) assert.equal(tab(core, closed.id).discarded, true);
          },
        })
      )
    )
  ),
  {
    name: "unsplit preserves the selected pane, resizing never produces negative bounds, and blank/error slots stay ordered",
    async run({ core, win }, url) {
      const a = await open(core, url("/page/split-bounds-a"));
      const b = await open(core, url("/page/split-bounds-b"));
      core.activateTab(a.id);
      core.toggleSplit(b.id);
      core.activateTab(b.id);
      for (const width of [0, 5, 9, 1001]) {
        core.setContentBounds({ height: 700, width, x: 8, y: 8 });
        const left = attached(win)
          .find((view) => view.webContents === a.wc)!
          .getBounds();
        const right = attached(win)
          .find((view) => view.webContents === b.wc)!
          .getBounds();
        assert.ok(left.width >= 0 && right.width >= 0);
        assert.equal(left.x, 8);
        assert.equal(right.x, left.x + left.width + Math.min(8, width));
        assert.equal(right.x + right.width, 8 + width);
        assert.deepEqual(getPaneTabIds(core.snapshot()), [a.id, b.id]);
      }
      core.setContentBounds({ height: 700, width: 1000, x: 8, y: 8 });
      const left = attached(win).find((view) => view.webContents === a.wc)!;
      const leftBounds = left.getBounds();
      core.navigate(b.id, url("/error/split-bounds"));
      await waitFor(
        () => Boolean(tab(core, b.id).error),
        "right pane fails to load"
      );
      assert.deepEqual(attached(win), [left]);
      core.activateTab(a.id);
      core.activateTab(b.id);
      assert.deepEqual(left.getBounds(), leftBounds);
      assert.deepEqual(getPaneTabIds(core.snapshot()), [a.id, b.id]);
      await finished(b.wc, () =>
        core.navigate(b.id, url("/page/split-recovered"))
      );
      await settled(core, b.id, b.wc, url("/page/split-recovered"));
      assert.equal(attached(win).length, 2);
      const blank = core.newTab();
      assert.deepEqual(getPaneTabIds(core.snapshot()), [a.id, blank.id]);
      assert.deepEqual(attached(win), [left]);
      assert.deepEqual(left.getBounds(), leftBounds);
      core.closeTab(blank.id);
      assert.equal(core.snapshot().activeTabId, a.id);
      for (const exitWithActive of [false, true]) {
        core.toggleSplit(b.id);
        core.activateTab(b.id);
        core.toggleSplit(exitWithActive ? b.id : a.id);
        assert.equal(core.snapshot().activeTabId, b.id);
        assert.equal(core.snapshot().splitTabId, null);
        assert.equal(core.snapshot().splitPrimaryTabId, null);
        assert.deepEqual(
          attached(win).map((view) => view.webContents),
          [b.wc]
        );
        assert.deepEqual(attached(win)[0]!.getBounds(), {
          height: 700,
          width: 1000,
          x: 8,
          y: 8,
        });
        core.activateTab(a.id);
      }
    },
  },
  {
    name: "moving either split pane to another workspace detaches it and preserves the partner",
    async run({ core, win }, url) {
      const firstSpace = core.snapshot().activeSpaceId;
      const secondSpace = core.createSpace("Split destination").id;
      core.activateSpace(firstSpace);
      const a = await open(core, url("/page/split-move-a"));
      const b = await open(core, url("/page/split-move-b"));
      core.activateTab(a.id);
      core.toggleSplit(b.id);
      const before = core.snapshot();
      core.moveTabToSpace(b.id, firstSpace);
      assert.deepEqual(
        core.snapshot(),
        before,
        "same-workspace moves preserve the split"
      );
      core.moveTabToSpace(b.id, secondSpace, { confirmReload: true });
      assert.equal(core.snapshot().activeTabId, a.id);
      assert.equal(core.snapshot().splitTabId, null);
      assert.equal(core.snapshot().splitPrimaryTabId, null);
      assert.deepEqual(
        attached(win).map((view) => view.webContents),
        [a.wc]
      );
      await waitFor(() => b.wc.isDestroyed(), "source profile view destroyed");
      core.moveTabToSpace(b.id, firstSpace, { confirmReload: true });
      core.toggleSplit(b.id);
      core.activateTab(b.id);
      core.moveTabToSpace(b.id, secondSpace, { confirmReload: true });
      assert.equal(core.snapshot().activeTabId, a.id);
      assert.deepEqual(
        attached(win).map((view) => view.webContents),
        [a.wc]
      );
      core.activateSpace(secondSpace);
      assert.equal(core.snapshot().activeTabId, b.id);
      assert.deepEqual(
        attached(win).map((view) => view.webContents),
        [core.getWebContentsForTab(b.id)]
      );
      assert.deepEqual(attached(win)[0]!.getBounds(), {
        height: 700,
        width: 1000,
        x: 8,
        y: 8,
      });
    },
  },
  {
    name: "dispose destroys active/inactive/split/Glance pages, flushes state, and is idempotent",
    async run({ core, win, seen, directory }, url) {
      const a = await open(core, url("/page/dispose-a"));
      await open(core, url("/page/dispose-inactive"));
      await open(core, url("/page/dispose-active"));
      core.toggleSplit(a.id);
      core.openPeek(url("/page/dispose-glance"));
      core.setPeekBounds({ height: 500, width: 700, x: 100, y: 100 });
      core.raisePeek();
      await waitFor(
        () =>
          [...seen].some(
            (wc) =>
              !wc.isDestroyed() &&
              wc.getURL() === url("/page/dispose-glance") &&
              !wc.isLoading()
          ),
        "Glance page load"
      );
      assert.equal(seen.size, 4);
      let emissions = 0;
      const unsubscribe = core.onState(() => {
        emissions++;
      });
      const before = core.snapshot();
      core.dispose();
      await waitFor(
        () => [...seen].every((wc) => wc.isDestroyed()),
        "all native pages destroyed by dispose"
      );
      assert.equal(core.getActiveWebContents(), undefined);
      assert.equal(
        win.isDestroyed(),
        false,
        "ArcCore does not own the host window's lifetime"
      );
      assert.doesNotThrow(() => core.dispose());
      assert.equal(emissions, 0, "disposal must not broadcast state changes");
      const saved = JSON.parse(
        readFileSync(join(directory, "zenmium/state.json"), "utf8")
      ) as ArcState;
      assert.deepEqual(
        saved.tabs.map((entry) => entry.id),
        before.tabs.map((entry) => entry.id)
      );
      assert.equal(saved.activeTabId, before.activeTabId);
      unsubscribe();
    },
  },
];

cases.push(
  {
    name: "profiles isolate real Chromium cookies, local storage, history and Glance",
    async run({ core }, url) {
      const firstSpace = core.snapshot().activeSpaceId;
      const destination = url("/page/profile-isolation");
      const first = await open(core, destination);
      const firstSession = core.getSessionForSpace(firstSpace);
      assert.equal(first.wc.session, firstSession);
      assert.notEqual(firstSession, session.defaultSession, "fresh profile is not the legacy shared session");
      await first.wc.executeJavaScript("document.cookie = 'isolation_fixture=first; SameSite=Lax; path=/'; localStorage.setItem('isolation_fixture', 'first');");
      const secondSpace = core.createSpace("Separate account").id;
      const second = await open(core, destination);
      const secondSession = core.getSessionForSpace(secondSpace);
      assert.notEqual(secondSession, firstSession);
      assert.equal(second.wc.session, secondSession);
      assert.notEqual(core.getProfileId(firstSpace), core.getProfileId(secondSpace));
      assert.equal(await second.wc.executeJavaScript("document.cookie.includes('isolation_fixture=')"), false);
      assert.equal(await second.wc.executeJavaScript("localStorage.getItem('isolation_fixture')"), null);
      assert.equal(core.getHistoryForSpace(firstSpace).filter((entry) => entry.url === destination).length, 1);
      assert.equal(core.getHistoryForSpace(secondSpace).filter((entry) => entry.url === destination).length, 1);
      assert.ok(core.snapshot().history?.every((entry) => entry.spaceId === secondSpace));
      core.openPeek(url("/page/profile-glance"));
      const peek = core.getPeekView()!;
      await waitFor(() => peek.webContents.getURL() === url("/page/profile-glance") && !peek.webContents.isLoading(), "profile Glance loads");
      assert.equal(peek.webContents.session, secondSession);
      assert.equal(core.getSpaceIdForWebContents(peek.webContents.id), secondSpace);
      assert.equal(await peek.webContents.executeJavaScript("localStorage.getItem('isolation_fixture')"), null);
      core.clearHistory();
      assert.equal(core.getHistoryForSpace(secondSpace).length, 0);
      assert.ok(core.getHistoryForSpace(firstSpace).length > 0);
      core.activateSpace(firstSpace);
      assert.equal(core.getPeekView(), null, "Glance cannot follow the user across profiles");
      assert.equal(await first.wc.executeJavaScript("localStorage.getItem('isolation_fixture')"), "first");
      assert.throws(() => core.getSessionForSpace("unknown-profile"), /Workspace not found/);
      assert.throws(() => core.newTab({ spaceId: "unknown-profile", background: true }), /Workspace not found/);
    },
  },
  {
    name: "profile migration backs up bytes and retains default authentication only for formerly active workspace",
    async run(_harness, url) {
      const directory = mkdtempSync(join(userData, "legacy-profile-"));
      mkdirSync(join(directory, "zenmium"));
      const legacy: ArcState = {
        activeSpaceId: "legacy-active", activeTabId: "legacy-tab", splitTabId: null,
        spaces: [
          { id: "legacy-other", name: "Other", color: "#6ee7a8", icon: "" },
          { id: "legacy-active", name: "Active", color: "#6ee7a8", icon: "" },
        ],
        tabs: [{ id: "legacy-tab", spaceId: "legacy-active", url: url("/page/legacy-profile"), title: "Legacy", kind: "today", folderId: null, loading: false, lastActiveAt: 1 }],
        history: [{ id: "legacy-visit", url: url("/page/legacy-history"), title: "Legacy history", visitedAt: 1 }],
        folders: [], archive: [],
      };
      const bytes = JSON.stringify(legacy);
      writeFileSync(join(directory, "zenmium/state.json"), bytes);
      let setupCalled = false;
      const migrated = makeHarness(directory, (core) => {
        core.onSessionCreated((entry) => {
          if (entry.spaceId === "legacy-active") {
            setupCalled = true;
            assert.equal(entry.session, session.defaultSession);
          }
        });
      });
      try {
        await settled(migrated.core, "legacy-tab", active(migrated.core), url("/page/legacy-profile"));
        assert.equal(setupCalled, true);
        assert.equal(active(migrated.core).session, session.defaultSession);
        assert.notEqual(migrated.core.getSessionForSpace("legacy-other"), session.defaultSession);
        assert.ok(migrated.core.getHistoryForSpace("legacy-active").some((entry) => entry.id === "legacy-visit"));
        assert.equal(migrated.core.getHistoryForSpace("legacy-other").length, 0);
        const backups = readdirSync(join(directory, "zenmium")).filter((file) => file.startsWith("state.pre-profiles-"));
        assert.equal(backups.length, 1);
        assert.equal(readFileSync(join(directory, "zenmium", backups[0]!), "utf8"), bytes);
        const profileIds = migrated.core.snapshot().spaces.map((space) => space.profileId);
        migrated.core.dispose();
        const restarted = makeHarness(directory);
        try {
          assert.deepEqual(restarted.core.snapshot().spaces.map((space) => space.profileId), profileIds);
          assert.equal(readdirSync(join(directory, "zenmium")).filter((file) => file.startsWith("state.pre-profiles-")).length, 1);
        } finally {
          restarted.core.dispose();
          restarted.win.destroy();
        }
      } finally {
        migrated.core.dispose();
        migrated.win.destroy();
      }
    },
  },
  {
    name: "async profile policy hooks gate every first request and initialization failure blocks loading",
    async run({ core }, url) {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      const unsubscribe = core.onSessionCreated(() => pending);
      const target = url("/page/profile-policy-gated");
      const requestCount = requests.get("/page/profile-policy-gated") ?? 0;
      const first = core.newTab({ url: target, background: true });
      const wc = core.getWebContentsForTab(first.id)!;
      await delay(100);
      assert.equal(wc.getURL(), "", "no document is loaded while policy setup is pending");
      assert.equal(requests.get("/page/profile-policy-gated") ?? 0, requestCount);
      release();
      await settled(core, first.id, wc, target);
      unsubscribe();
      const unsubscribeFailure = core.onSessionCreated(() => Promise.reject(new Error("Synthetic policy fixture failure")));
      const blocked = core.newTab({ url: url("/page/profile-policy-blocked"), background: true });
      await waitFor(() => Boolean(tab(core, blocked.id).error), "policy failure surfaces native tab error");
      assert.equal(core.getWebContentsForTab(blocked.id)!.getURL(), "");
      assert.equal(requests.get("/page/profile-policy-blocked") ?? 0, 0);
      unsubscribeFailure();
    },
  },
  {
    name: "background agent tabs and popup navigation never activate, focus or create another tab",
    async run({ core, win }, url) {
      const human = await open(core, url("/page/human-working"));
      const before = core.snapshot();
      const windows = BrowserWindow.getAllWindows().length;
      let nativeFocusCalls = 0;
      const previousFocus = core.focusActive.bind(core);
      core.focusActive = () => { nativeFocusCalls++; previousFocus(); };
      const agent = core.newTab({ url: url("/page/agent-owned"), background: true, ownerSessionId: "fixture-agent-session" });
      const agentPage = core.getWebContentsForTab(agent.id)!;
      await settled(core, agent.id, agentPage, url("/page/agent-owned"));
      assert.equal(core.snapshot().activeTabId, human.id);
      assert.equal(core.snapshot().activeSpaceId, before.activeSpaceId);
      assert.equal(nativeFocusCalls, 0);
      assert.deepEqual(attached(win).map((view) => view.webContents), [human.wc]);
      const count = core.snapshot().tabs.length;
      await agentPage.executeJavaScript(`window.open(${JSON.stringify(url("/page/agent-popup-reused"))}, '_blank')`);
      await settled(core, agent.id, agentPage, url("/page/agent-popup-reused"));
      assert.equal(core.snapshot().tabs.length, count);
      assert.equal(BrowserWindow.getAllWindows().length, windows);
      assert.equal(core.snapshot().activeTabId, human.id);
      assert.equal(core.getPeekView(), null);
      assert.equal(nativeFocusCalls, 0);
      assert.equal(human.wc.getURL(), url("/page/human-working"));
      const implicit = core.newTab({ ownerSessionId: "fixture-second-session" });
      assert.ok(core.getWebContentsForTab(implicit.id), "blank agent tabs materialize a controllable native target");
      assert.equal(core.snapshot().activeTabId, human.id);
      assert.equal(nativeFocusCalls, 0);
    },
  },
  {
    name: "live cross-profile moves require confirmation, replace the view and leave accounts and forms behind",
    async run({ core }, url) {
      const sourceSpace = core.snapshot().activeSpaceId;
      const targetSpace = core.createSpace("Move target").id;
      core.activateSpace(sourceSpace);
      const source = await open(core, url("/page/profile-move"));
      await source.wc.executeJavaScript("localStorage.setItem('move_fixture', 'source-only'); document.getElementById('unsaved-input').value = 'unsaved fixture';");
      const before = core.snapshot();
      const warning = core.moveTabToSpace(source.id, targetSpace);
      assert.equal(warning.status, "confirmation-required");
      assert.deepEqual(core.snapshot(), before);
      assert.equal(core.getWebContentsForTab(source.id), source.wc);
      assert.equal(await source.wc.executeJavaScript("document.getElementById('unsaved-input').value"), "unsaved fixture");
      assert.equal(core.moveTabToSpace(source.id, targetSpace, { confirmReload: true }).status, "moved");
      await waitFor(() => source.wc.isDestroyed(), "cross-profile source native view destroyed");
      const replacement = core.getWebContentsForTab(source.id)!;
      assert.notEqual(replacement, source.wc);
      await settled(core, source.id, replacement, url("/page/profile-move"));
      assert.equal(replacement.session, core.getSessionForSpace(targetSpace));
      assert.equal(await replacement.executeJavaScript("localStorage.getItem('move_fixture')"), null);
      assert.equal(await replacement.executeJavaScript("document.getElementById('unsaved-input').value"), "");
      assert.equal(replacement.navigationHistory.canGoBack(), false);
      assert.equal(core.getSpaceIdForWebContents(replacement.id), targetSpace);
      assert.equal(core.snapshot().activeSpaceId, sourceSpace);
    },
  },
  {
    name: "agent session folders stay unpinned and closing an owned tab really destroys it",
    async run({ core }, url) {
      const human = await open(core, url("/page/group-human"));
      const spaceId = core.snapshot().activeSpaceId;
      const folder = core.createFolder(spaceId, "Fixture agent session");
      const owned = core.newTab({ url: url("/page/group-agent"), ownerSessionId: "fixture-group-owner" });
      const wc = core.getWebContentsForTab(owned.id)!;
      await settled(core, owned.id, wc, url("/page/group-agent"));
      core.moveToFolder(owned.id, folder.id);
      assert.equal(tab(core, owned.id).kind, "today");
      assert.equal(tab(core, owned.id).pinnedUrl, undefined);
      assert.equal(tab(core, owned.id).folderId, folder.id);
      assert.throws(() => core.pinTab(owned.id), /agent-session tab/);
      core.closeTab(owned.id);
      await waitFor(() => wc.isDestroyed(), "owned group tab really closes");
      assert.equal(core.snapshot().tabs.some((entry) => entry.id === owned.id), false);
      assert.equal(core.snapshot().activeTabId, human.id);
      const adopted = await open(core, url("/page/group-adopted"));
      core.setTabOwner(adopted.id, "fixture-adopter");
      assert.equal(tab(core, adopted.id).ownerSessionId, "fixture-adopter");
      assert.throws(() => core.setTabOwner(adopted.id, "fixture-other"), /Release existing/);
      core.setTabOwner(adopted.id, undefined);
      assert.equal(tab(core, adopted.id).ownerSessionId, undefined);
    },
  },
  {
    name: "local documents require the main-only file entry and support pin reset/archive reopen",
    async run({ core, directory }, url) {
      const file = join(directory, "selected-file.html");
      writeFileSync(file, "<!doctype html><title>Selected local fixture</title><h1>Local fixture</h1>");
      assert.throws(() => core.newTab({ url: `file://${file}` }), /cannot be opened/);
      assert.throws(() => core.openLocalFile("selected-file.html"), /absolute local file/);
      const invalid = join(directory, "not-a-document.txt");
      writeFileSync(invalid, "Fixture");
      assert.throws(() => core.openLocalFile(invalid), /HTML or PDF/);
      const local = core.openLocalFile(file);
      const wc = core.getWebContentsForTab(local.id)!;
      await settled(core, local.id, wc, local.url);
      assert.equal(wc.getTitle(), "Selected local fixture");
      assert.equal(wc.session, core.getSessionForSpace(local.spaceId));
      core.pinTab(local.id);
      await finished(wc, () => core.navigate(local.id, url("/page/away-from-local")));
      await finished(wc, () => core.resetTab(local.id));
      await settled(core, local.id, wc, local.url);
      core.unpinTab(local.id);
      core.closeTab(local.id);
      core.restoreTab(local.id);
      const reopened = core.snapshot().activeTabId!;
      await settled(core, reopened, active(core), local.url);
      assert.equal(active(core).getTitle(), "Selected local fixture");
      assert.notEqual(reopened, local.id);
    },
  }
);

// Hard ceiling also covers startup/shutdown hangs; individual waits have tighter limits.
const watchdog = setTimeout(() => {
  console.error("[native-core] FAIL: suite exceeded 180 seconds");
  app.exit(1);
}, 180_000);
async function runSuite(): Promise<void> {
  // The suite must never activate itself over an existing browser/UI verifier.
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
  let failures = 0;
  let executed = 0;
  let unavailable = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = (path: string) => `http://127.0.0.1:${address.port}${path}`;
    for (const test of cases) {
      executed++;
      let harness: Harness | undefined;
      try {
        harness = makeHarness();
        await test.run(harness, url);
        console.log(`[native-core] PASS ${test.name}`);
      } catch (error) {
        if (error instanceof NativeInputUnavailable) {
          unavailable++;
          console.log(
            `[native-core] UNAVAILABLE ${test.name}: ${error.message}`
          );
        } else {
          failures++;
          console.error(`[native-core] FAIL ${test.name}\n`, error);
        }
      } finally {
        if (harness) {
          try {
            harness.core.dispose();
            await waitFor(
              () => [...harness!.seen].every((wc) => wc.isDestroyed()),
              "case cleanup destroys every page"
            );
          } catch (error) {
            failures++;
            console.error("[native-core] FAIL case cleanup", error);
          } finally {
            if (!harness.win.isDestroyed()) harness.win.destroy();
          }
        }
      }
    }
  } catch (error) {
    failures++;
    console.error("[native-core] FAIL startup", error);
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    clearTimeout(watchdog);
    console.log(
      `[native-core] ${executed}/${cases.length} cases attempted; ${failures} failure(s); ${unavailable} unavailable (not passed). userData retained: ${userData}`
    );
    app.exit(failures ? 1 : 0);
  }
}

// Electron must finish evaluating its ESM entry before it can emit app.ready.
// Do not introduce top-level await here, including indirectly awaiting runSuite().
void app
  .whenReady()
  .then(runSuite)
  .catch((error: unknown) => {
    clearTimeout(watchdog);
    console.error("[native-core] FAIL before suite completion", error);
    server.closeAllConnections();
    app.exit(1);
  });
