import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ExtensionHost, type ExtensionSessionLike } from "../src/main/extension-host.ts";

const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
async function fixture(nested = false) {
  const root = await mkdtemp(join(tmpdir(), "zenmium-extension-test-"));
  const directory = join(root, "extension"); await mkdir(directory);
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ name: "Fixture", version: "1.0", manifest_version: 2 }));
  const removed: string[] = [], options: unknown[] = [];
  let failNext = false;
  const api = {
    async loadExtension(path: string, opts: unknown) {
      options.push(opts);
      if (failNext) { failNext = false; throw new Error("fixture failure"); }
      return { id: runtimeId, path, name: "Native name", version: "1.2", manifest: { action: { default_popup: "popup.html" } } };
    },
    removeExtension(id: string) { assert.equal(typeof id, "string"); removed.push(id); },
  };
  const session: ExtensionSessionLike = nested ? { extensions: api } : api;
  const host = new ExtensionHost({ session, profileId: "profile-a", events: new EventEmitter(), registryPath: join(root, "a", "extensions.json") });
  const input = { id: directory, path: directory, name: "Requested", version: "0", enabled: true };
  return { root, directory, session, host, input, removed, options, failLoad: () => { failNext = true; } };
}
for (const nested of [false, true]) test("canonical identity and disable/restore on " + (nested ? "nested" : "legacy") + " API", async () => {
  const f = await fixture(nested);
  const loaded = await f.host.load(f.input); assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.value.id, runtimeId); assert.equal(loaded.value.name, "Native name");
  assert.deepEqual(f.host.loadedIds(), [runtimeId]); assert.deepEqual(f.options, [{ allowFileAccess: false }]);
  assert.equal(f.host.get(f.input.id), undefined);
  const popup = f.host.actionPopup(runtimeId); assert.equal(popup.ok, true);
  if (popup.ok) assert.equal(popup.value.url, "chrome-extension://" + runtimeId + "/popup.html");
  assert.equal((await f.host.setPinned(runtimeId, true)).ok, true);
  assert.equal(f.host.get(runtimeId)?.pinned, true);
  assert.equal((await f.host.setEnabled(runtimeId, false)).ok, true);
  assert.deepEqual(f.removed, [runtimeId]); assert.deepEqual(f.host.loadedIds(), []);
  const restored = new ExtensionHost({ session: f.session, profileId: "profile-a", events: new EventEmitter(), registryPath: f.host.registryPath });
  assert.deepEqual(await restored.boot(), { ok: true, value: { loaded: [], failed: [] } });
  assert.equal((await restored.setEnabled(runtimeId, true)).ok, true);
  assert.deepEqual(restored.loadedIds(), [runtimeId]);
  assert.equal((await restored.remove(runtimeId)).ok, true);
  assert.deepEqual(restored.list(), []);
});
test("profile registries reject cross-profile reuse and default sessions", async () => {
  const f = await fixture(); await f.host.load(f.input);
  const other = new ExtensionHost({ session: f.session, profileId: "profile-b", events: new EventEmitter(), registryPath: f.host.registryPath });
  assert.equal((await other.boot()).ok, false);
  assert.throws(() => new ExtensionHost({ profileId: "profile-b", events: new EventEmitter() }));
  const independent = new ExtensionHost({ session: f.session, profileId: "profile-b", events: new EventEmitter(), registryPath: join(f.root, "b", "extensions.json") });
  assert.deepEqual(await independent.boot(), { ok: true, value: { loaded: [], failed: [] } });
});
test("store identity mismatch is refused rather than persisted under a caller-supplied ID", async () => {
  const f = await fixture();
  assert.equal((await f.host.load({ ...f.input, source: "store", id: "p".repeat(32) })).ok, false);
  assert.deepEqual(f.host.list(), []); assert.deepEqual(f.removed, [runtimeId]);
});
test("v1 path IDs migrate to runtime IDs without retaining duplicate rows", async () => {
  const f = await fixture(); await mkdir(join(f.root, "a"));
  await writeFile(f.host.registryPath, JSON.stringify({ version: 1, extensions: { [f.input.id]: f.input } }));
  assert.deepEqual(await f.host.boot(), { ok: true, value: { loaded: [runtimeId], failed: [] } });
  const stored = JSON.parse(await readFile(f.host.registryPath, "utf8"));
  assert.equal(stored.version, 2); assert.equal(stored.profileId, "profile-a");
  assert.deepEqual(Object.keys(stored.extensions), [runtimeId]);
});
test("enabled-but-unloaded records retry; concurrent mutations serialize", async () => {
  const f = await fixture(); await f.host.load(f.input); await f.host.dispose();
  f.failLoad(); assert.equal((await f.host.setEnabled(runtimeId, true)).ok, false);
  assert.equal((await f.host.setEnabled(runtimeId, true)).ok, true);
  await Promise.all([f.host.setEnabled(runtimeId, false), f.host.setEnabled(runtimeId, true), f.host.remove(runtimeId)]);
  assert.deepEqual(f.host.list(), []); assert.deepEqual(f.host.loadedIds(), []);
});
test("malformed registry is not silently overwritten", async () => {
  const f = await fixture(); await mkdir(join(f.root, "a"));
  await writeFile(f.host.registryPath, "not json");
  assert.equal((await f.host.load(f.input)).ok, false);
  assert.equal(await readFile(f.host.registryPath, "utf8"), "not json");
});
