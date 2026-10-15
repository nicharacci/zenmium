import { randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ArcState, BrowserProfile } from "../shared/ipc.ts";

export const PROFILE_SCHEMA_VERSION = 1;

export function newBrowserProfile(): BrowserProfile {
  const id = `profile_${randomUUID()}`;
  return { id, partition: `persist:zenmium-${id}` };
}

/** Pure, idempotent migration. Authentication is never copied between profiles. */
export function migrateProfileState(
  source: ArcState,
  hasLegacyState: boolean
): { state: ArcState; changed: boolean } {
  if ((source.schemaVersion ?? 0) > PROFILE_SCHEMA_VERSION)
    throw new Error("This browser profile was saved by a newer Zenmium version.");
  const state = structuredClone(source);
  const migrating = (state.schemaVersion ?? 0) < PROFILE_SCHEMA_VERSION;
  const previous = new Map((state.profiles ?? []).map((p) => [p.id, p]));
  const claimed = new Set<string>();
  const partitions = new Set<string>();
  const profiles: BrowserProfile[] = [];
  for (const space of state.spaces) {
    let profile = space.profileId ? previous.get(space.profileId) : undefined;
    // Never accept duplicate/path-like partitions or ambiguous default sessions.
    if (
      !profile ||
      !/^profile_[a-zA-Z0-9_-]+$/.test(profile.id) ||
      claimed.has(profile.id) ||
      partitions.has(profile.partition) ||
      (profile.partition !== "" &&
        profile.partition !== `persist:zenmium-${profile.id}`)
    ) {
      if (!migrating)
        throw new Error("Workspace profile metadata is invalid. Restore its backup before continuing.");
      profile = newBrowserProfile();
    }
    if (migrating) {
      // Only the formerly active workspace inherits pre-profile authentication.
      profile = newBrowserProfile();
      if (hasLegacyState && space.id === state.activeSpaceId)
        profile.partition = "";
    }
    space.profileId = profile.id;
    claimed.add(profile.id);
    partitions.add(profile.partition);
    profiles.push(profile);
  }
  state.profiles = profiles;
  state.schemaVersion = PROFILE_SCHEMA_VERSION;
  state.history = (state.history ?? []).map((entry) => ({
    ...entry,
    spaceId: entry.spaceId ?? state.activeSpaceId,
  }));
  return { changed: migrating, state };
}

/** Copies exact pre-migration bytes, exclusively; does not serialize credentials. */
export function backupLegacyProfileState(userDataDir: string): string | null {
  const source = join(userDataDir, "zenmium", "state.json");
  if (!existsSync(source)) return null;
  const backup = join(
    userDataDir,
    "zenmium",
    `state.pre-profiles-${Date.now()}-${randomUUID()}.json`
  );
  copyFileSync(source, backup, constants.COPYFILE_EXCL);
  return backup;
}
