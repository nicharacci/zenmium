import { randomUUID } from "node:crypto";
import { app, type DownloadItem, type Session, shell } from "electron";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { DownloadRecord } from "../shared/browser-ui";
import { JsonStore } from "./state-store";

export class BrowserDownloads {
  private records: DownloadRecord[];
  private items = new Map<string, DownloadItem>();
  private store: JsonStore<DownloadRecord[]>;
  private sessions = new Map<Session, (event: Electron.Event, item: DownloadItem) => void>();
  constructor(
    userDataDir: string,
    private changed: () => void
  ) {
    this.store = new JsonStore(userDataDir, "downloads.json");
    this.records = this.store.read([]).map((item) => ({
      ...item,
      state: item.state === "progressing" ? "interrupted" : item.state,
    }));
  }
  attach(profileId: string, spaceId: string, target: Session): void {
    if (this.sessions.has(target)) return;
    // Legacy records belonged to the previously active default-session Workspace.
    if (this.sessions.size === 0) for (const record of this.records) {
      if (!record.profileId) Object.assign(record, { profileId, spaceId });
    }
    const listener = (event: Electron.Event, item: DownloadItem) => this.onDownload(event, item, profileId, spaceId);
    this.sessions.set(target, listener);
    target.on("will-download", listener);
  }
  private onDownload = (_event: Electron.Event, item: DownloadItem, profileId: string, spaceId: string) => {
    const id = randomUUID();
    const record: DownloadRecord = {
      filename: item.getFilename(),
      id,
      profileId,
      spaceId,
      path: "",
      paused: false,
      received: 0,
      startedAt: Date.now(),
      state: "progressing",
      total: item.getTotalBytes(),
      url: item.getURL(),
    };
    this.records.unshift(record);
    this.records = this.records.slice(0, 200);
    this.items.set(id, item);
    // Saving to a collision-free Downloads path avoids a modal stealing focus
    // during background agent work. Opening a file remains an explicit action.
    const filename = basename(item.getFilename()).replace(/[\u0000-\u001f]/g, "_") || "download";
    let path = item.getSavePath() || join(app.getPath("downloads"), filename);
    let suffix = 1;
    while (existsSync(path) || this.records.some((r) => r.id !== id && r.path === path && r.state === "progressing")) {
      const ext = extname(filename);
      path = join(app.getPath("downloads"), `${basename(filename, ext)} (${suffix++})${ext}`);
    }
    item.setSavePath(path);
    const update = () => {
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      record.paused = item.isPaused();
      record.path = item.getSavePath();
      this.changed();
    };
    item.on("updated", (_e, state) => {
      record.state = state;
      update();
    });
    item.once("done", (_e, state) => {
      record.state = state;
      update();
      this.items.delete(id);
      this.store.write(this.records);
    });
    update();
    this.store.write(this.records);
  };
  list(profileId?: string): DownloadRecord[] {
    return structuredClone(this.records.filter((r) => !profileId || r.profileId === profileId));
  }
  async action(id: string, action: string, profileId?: string): Promise<void> {
    const record = this.records.find((r) => r.id === id && (!profileId || r.profileId === profileId));
    if (!record) throw new Error("Download not found.");
    const item = this.items.get(id);
    if (action === "pause" && item) item.pause();
    else if (action === "resume" && item?.canResume()) item.resume();
    else if (action === "cancel" && item) item.cancel();
    else if (action === "show" && record.path)
      shell.showItemInFolder(record.path);
    else if (action === "open" && record.state === "completed" && record.path) {
      const error = await shell.openPath(record.path);
      if (error) throw new Error(error);
    } else throw new Error("This action is unavailable for this download.");
    this.changed();
  }
  dispose(): void {
    for (const [target, listener] of this.sessions) target.off("will-download", listener);
    this.sessions.clear();
    this.store.write(this.records);
  }
}
