import { session } from "electron";
import type { BrowserProfile, Space } from "../shared/ipc";

export interface WorkspaceSession {
  spaceId: string;
  profileId: string;
  session: Electron.Session;
}

/** Only this factory resolves persisted profile metadata into Chromium sessions. */
export class WorkspaceSessions {
  private readonly initialized = new Map<string, WorkspaceSession>();
  private readonly listeners = new Set<(entry: WorkspaceSession) => void | Promise<void>>();
  private readonly readiness = new Map<string, Promise<void>>();

  private track(profileId: string, pending: Array<void | Promise<void>>): void {
    const asynchronous = pending.filter((result): result is Promise<void> => Boolean(result));
    const previous = this.readiness.get(profileId);
    if (previous) asynchronous.unshift(previous);
    if (!asynchronous.length) return;
    const ready = Promise.all(asynchronous).then(() => {});
    this.readiness.set(profileId, ready);
    // Retain failures for load gating without an unhandled rejection when no
    // page has been opened in this profile yet.
    void ready.then(() => {
      if (this.readiness.get(profileId) === ready) this.readiness.delete(profileId);
    }, () => {});
  }

  get(space: Space, profile: BrowserProfile): Electron.Session {
    const existing = this.initialized.get(profile.id);
    if (existing) return existing.session;
    const entry: WorkspaceSession = {
      profileId: profile.id,
      session: profile.partition === ""
        ? session.defaultSession
        : session.fromPartition(profile.partition),
      spaceId: space.id,
    };
    this.initialized.set(profile.id, entry);
    try {
      // Synchronous policy hooks run before ensureView can construct/load a page.
      this.track(profile.id, [...this.listeners].map((listener) => listener({ ...entry })));
    } catch (error) {
      this.initialized.delete(profile.id);
      throw error;
    }
    return entry.session;
  }

  onCreated(listener: (entry: WorkspaceSession) => void | Promise<void>): () => void {
    for (const entry of this.initialized.values()) this.track(entry.profileId, [listener({ ...entry })]);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ready(profileId: string): Promise<void> | undefined {
    return this.readiness.get(profileId);
  }

  forget(profileId: string): void {
    this.initialized.delete(profileId);
    this.readiness.delete(profileId);
  }

  dispose(): void {
    this.listeners.clear();
    this.initialized.clear();
    this.readiness.clear();
  }
}
