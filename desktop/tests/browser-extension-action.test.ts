import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  bridgeScript,
  bridgeUrl,
  interpretBridgeResult,
} from "../src/main/extension-action-bridge.ts";
import { ExtensionHost } from "../src/main/extension-host.ts";

const NO_POPUP_ID = "dhapfpkbeokfngalhbijopidpadjdppk";

test("bridge URL is anchored to the extension origin", () => {
  assert.equal(
    bridgeUrl(NO_POPUP_ID),
    `chrome-extension://${NO_POPUP_ID}/zenmium-action-bridge.html`
  );
  assert.throws(() => bridgeUrl("../evil"));
});

test("bridge script carries the message type and optional tab id", () => {
  assert.equal(bridgeScript().includes("zenmium:extension-action"), true);
  assert.equal(bridgeScript(7).includes("tabId: 7"), true);
});

test("bridge responses never forward provider text", () => {
  assert.deepEqual(
    interpretBridgeResult({ ok: true, response: { ok: true } }),
    { ok: true, reason: "ok" }
  );
  assert.equal(
    interpretBridgeResult({
      ok: true,
      response: { error: "secret", ok: false },
    }).ok,
    false
  );
  assert.equal(interpretBridgeResult({ ok: false }).ok, false);
});

test("bridge success requires an explicit inner acknowledgement", () => {
  for (const response of [undefined, null, {}, { ok: false }, { ok: "true" }, { error: "secret" }]) {
    const result = interpretBridgeResult({ ok: true, response });
    assert.equal(result.ok, false);
    assert.equal(result.reason.includes("secret"), false);
  }
  assert.equal(
    interpretBridgeResult({ ok: false, response: { ok: true } }).ok,
    false
  );
});

test("popup trigger and following queued disable both complete", { timeout: 2000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zenmium-popup-test-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const directory = join(root, "extension");
  await mkdir(directory);
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify({ manifest_version: 3, name: "Popup", version: "1.0" })
  );
  const operations: string[] = [];
  const session = {
    loadExtension(path: string) {
      return Promise.resolve({
        id: NO_POPUP_ID,
        manifest: { action: { default_popup: "popup.html" } },
        name: "Popup",
        path,
        version: "1.0",
      });
    },
    removeExtension() {
      operations.push("disabled");
    },
  };
  const host = new ExtensionHost({
    dispatchAction: () => {
      assert.fail("Popup extensions must not use the bridge.");
    },
    events: new EventEmitter(),
    openPopup: (action, targetSession) => {
      assert.equal(targetSession, session);
      assert.deepEqual(action, {
        extensionId: NO_POPUP_ID,
        profileId: "profile-popup",
        url: `chrome-extension://${NO_POPUP_ID}/popup.html`,
      });
      operations.push("opened");
      return Promise.resolve();
    },
    profileId: "profile-popup",
    registryPath: join(root, "extensions.json"),
    session,
  });
  assert.equal((await host.load({
    enabled: true,
    id: directory,
    name: "Popup",
    path: directory,
    version: "1.0",
  })).ok, true);
  const triggered = host.triggerAction(NO_POPUP_ID);
  const disabled = host.setEnabled(NO_POPUP_ID, false);
  const timer = setTimeout(() => undefined, 2000);
  t.after(() => clearTimeout(timer));
  assert.deepEqual(await triggered, { ok: true, value: { triggered: true } });
  assert.equal((await disabled).ok, true);
  assert.deepEqual(operations, ["opened", "disabled"]);
  assert.deepEqual(host.loadedIds(), []);
});

test("toolbar trigger dispatches no-popup extensions through the bridge", async () => {
  const root = await mkdtemp(join(tmpdir(), "zenmium-action-test-"));
  const directory = join(root, "extension");
  await mkdir(directory);
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify({ manifest_version: 3, name: "NoPopup", version: "1.0" })
  );
  const dispatched: Array<{ id: string; tabId?: number }> = [];
  const api = {
    loadExtension(path: string) {
      return Promise.resolve({
        id: NO_POPUP_ID,
        manifest: { action: {} },
        name: "NoPopup",
        path,
        version: "0.1.11",
      });
    },
    removeExtension() {
      // Fixture records removals through the host registry, not here.
    },
  };
  const host = new ExtensionHost({
    dispatchAction: (id, _session, tabId) => {
      dispatched.push({ id, tabId });
      return Promise.resolve();
    },
    events: new EventEmitter(),
    profileId: "profile-action",
    registryPath: join(root, "extensions.json"),
    session: api,
  });
  const loaded = await host.load({
    enabled: true,
    id: directory,
    name: "NoPopup",
    path: directory,
    version: "0",
  });
  assert.equal(loaded.ok, true);
  const triggered = await host.triggerAction(NO_POPUP_ID, 12);
  assert.equal(triggered.ok, true);
  assert.deepEqual(dispatched, [{ id: NO_POPUP_ID, tabId: 12 }]);
});

test("toolbar trigger without a dispatch surface fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "zenmium-action-test-"));
  const directory = join(root, "extension");
  await mkdir(directory);
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify({ manifest_version: 3, name: "NoPopup", version: "1.0" })
  );
  const api = {
    loadExtension(path: string) {
      return Promise.resolve({
        id: NO_POPUP_ID,
        manifest: { action: {} },
        name: "NoPopup",
        path,
        version: "0.1.11",
      });
    },
    removeExtension() {
      // Fixture records removals through the host registry, not here.
    },
  };
  const host = new ExtensionHost({
    events: new EventEmitter(),
    profileId: "profile-action-closed",
    registryPath: join(root, "extensions.json"),
    session: api,
  });
  assert.equal(
    (
      await host.load({
        enabled: true,
        id: directory,
        name: "NoPopup",
        path: directory,
        version: "0",
      })
    ).ok,
    true
  );
  assert.equal((await host.triggerAction(NO_POPUP_ID)).ok, false);
});
