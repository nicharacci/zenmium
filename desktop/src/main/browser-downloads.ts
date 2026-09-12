import { randomUUID } from "node:crypto";
import { type DownloadItem, session, shell } from "electron";
import type { DownloadRecord } from "../shared/browser-ui";
import { JsonStore } from "./state-store";

export class BrowserDownloads {
  private records: DownloadRecord[];
  private items = new Map<string, DownloadItem>();
  private store: JsonStore<DownloadRecord[]>;
  constructor(
    userDataDir: string,
    private changed: () => void
  ) {
    this.store = new JsonStore(userDataDir, "downloads.json");
    this.records = this.store.read([]).map((item) => ({
      ...item,
      state: item.state === "progressing" ? "interrupted" : item.state,
    }));
    session.defaultSession.on("will-download", this.onDownload);
  }
  private onDownload = (_event: Electron.Event, item: DownloadItem) => {
    const id = randomUUID();
    const record: DownloadRecord = {
      filename: item.getFilename(),
      id,
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
  };
  list(): DownloadRecord[] {
    return structuredClone(this.records);
  }
  async action(id: string, action: string): Promise<void> {
    const record = this.records.find((r) => r.id === id);
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
    session.defaultSession.off("will-download", this.onDownload);
    this.store.write(this.records);
  }
}
