import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backupLegacyProfileState, migrateProfileState, PROFILE_SCHEMA_VERSION } from "../src/main/profile-state.ts";
import type { ArcState } from "../src/shared/ipc.ts";

function legacyState(): ArcState {
  return {
    spaces: [
      { id: "one", name: "First", color: "#6ee7a8", icon: "" },
      { id: "two", name: "Second", color: "#8ab4f8", icon: "" },
      { id: "three", name: "Third", color: "#f6a5c0", icon: "" },
    ],
    activeSpaceId: "two", activeTabId: null, splitTabId: null,
    archive: [], folders: [], tabs: [],
    history: [{ id: "visit", title: "Fixture", url: "https://fixture.invalid", visitedAt: 1 }],
  };
}

test("migration assigns only the previously active workspace the legacy session", () => {
  const original = legacyState();
  const before = structuredClone(original);
  const { state, changed } = migrateProfileState(original, true);
  assert.equal(changed, true);
  assert.equal(state.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.deepEqual(original, before, "pure migration preserves the input snapshot");
  assert.equal(state.profiles?.length, 3);
  assert.equal(new Set(state.spaces.map((s) => s.profileId)).size, 3);
  for (const space of state.spaces) {
    const profile = state.profiles!.find((p) => p.id === space.profileId)!;
    assert.equal(profile.partition, space.id === "two" ? "" : `persist:zenmium-${profile.id}`);
  }
  assert.equal(state.history?.[0]?.spaceId, "two");
});

test("fresh installations use only persistent isolated named partitions", () => {
  const { state } = migrateProfileState(legacyState(), false);
  assert.ok(state.profiles?.every((profile) => profile.partition.startsWith("persist:zenmium-profile_")));
});

test("migration is idempotent and rename/reorder never reassigns browser identities", () => {
  const first = migrateProfileState(legacyState(), true).state;
  first.spaces.reverse();
  first.spaces[0]!.name = "Renamed";
  first.activeSpaceId = "one";
  const second = migrateProfileState(first, true);
  assert.equal(second.changed, false);
  assert.deepEqual(new Map(second.state.profiles?.map((p) => [p.id, p.partition])), new Map(first.profiles?.map((p) => [p.id, p.partition])));
  assert.deepEqual(second.state.spaces, first.spaces);
  assert.equal(second.state.history?.[0]?.spaceId, "two");
});

test("invalid, duplicated and newer-version profile metadata fails closed", () => {
  const fresh = () => migrateProfileState(legacyState(), true).state;
  const duplicate = fresh();
  duplicate.spaces[1]!.profileId = duplicate.spaces[0]!.profileId;
  assert.throws(() => migrateProfileState(duplicate, true), /metadata is invalid/);
  const missing = fresh();
  missing.profiles = [];
  assert.throws(() => migrateProfileState(missing, true), /metadata is invalid/);
  const path = fresh();
  path.profiles![0]!.partition = "persist:../../another-profile";
  assert.throws(() => migrateProfileState(path, true), /metadata is invalid/);
  const twoDefaults = fresh();
  twoDefaults.profiles![0]!.partition = "";
  assert.throws(() => migrateProfileState(twoDefaults, true), /metadata is invalid/);
  const future = fresh();
  future.schemaVersion = PROFILE_SCHEMA_VERSION + 1;
  assert.throws(() => migrateProfileState(future, true), /newer Zenmium/);
});

test("migration backup preserves exact legacy bytes and never overwrites an older backup", () => {
  const directory = mkdtempSync(join(tmpdir(), "zenmium-profile-migration-"));
  assert.equal(backupLegacyProfileState(directory), null);
  mkdirSync(join(directory, "zenmium"));
  const bytes = `  ${JSON.stringify(legacyState())}\n`;
  writeFileSync(join(directory, "zenmium", "state.json"), bytes);
  const first = backupLegacyProfileState(directory)!;
  const second = backupLegacyProfileState(directory)!;
  assert.notEqual(first, second);
  assert.equal(readFileSync(first, "utf8"), bytes);
  assert.equal(readFileSync(second, "utf8"), bytes);
  assert.equal(readFileSync(join(directory, "zenmium", "state.json"), "utf8"), bytes);
  assert.equal(readdirSync(join(directory, "zenmium")).length, 3);
});
