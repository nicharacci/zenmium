import { randomUUID } from "node:crypto";
import type { Bookmark } from "../shared/browser-native";
import { JsonStore } from "./state-store";
import { webUrl } from "./browser-url";
import { importBookmarks } from "./browser-bookmark-format";

export class BrowserBookmarks {
  private store: JsonStore<Bookmark[]>;
  private records: Bookmark[];
  constructor(directory: string) {
    this.store = new JsonStore(directory, "bookmarks.json");
    const saved = this.store.read([]);
    this.records = Array.isArray(saved) ? saved.filter((r) => r && typeof r.id === "string" && typeof r.profileId === "string" && typeof r.title === "string" && ["bookmark", "folder"].includes(r.kind) && (r.kind === "folder" || (typeof r.url === "string" && webUrl(r.url)))) : [];
  }
  list(profileId: string): Bookmark[] { return structuredClone(this.records.filter((b) => b.profileId === profileId)); }
  private parent(profileId: string, id: string | null): void {
    if (id !== null && !this.records.some((b) => b.id === id && b.profileId === profileId && b.kind === "folder")) throw new Error("Bookmark folder not found in this Workspace.");
  }
  add(profileId: string, input: { title: string; url?: string; parentId?: string | null }): Bookmark {
    const parentId = input.parentId ?? null;
    this.parent(profileId, parentId);
    const url = input.url === undefined ? undefined : webUrl(input.url);
    if (url === null) throw new Error("Bookmarks require a valid HTTP(S) URL.");
    const record: Bookmark = { id: randomUUID(), profileId, parentId, title: input.title, url, kind: url ? "bookmark" : "folder", createdAt: Date.now() };
    this.records.push(record);
    this.store.write(this.records);
    return structuredClone(record);
  }
  update(profileId: string, id: string, patch: { title?: string; url?: string; parentId?: string | null }): void {
    const record = this.records.find((b) => b.id === id && b.profileId === profileId);
    if (!record) throw new Error("Bookmark not found in this Workspace.");
    if (patch.parentId !== undefined) {
      this.parent(profileId, patch.parentId);
      const seen = new Set<string>([id]);
      let ancestor = patch.parentId;
      while (ancestor !== null) {
        if (seen.has(ancestor)) throw new Error("A folder cannot contain itself.");
        seen.add(ancestor);
        ancestor = this.records.find((b) => b.id === ancestor && b.profileId === profileId)?.parentId ?? null;
      }
    }
    const url = patch.url === undefined ? record.url : webUrl(patch.url);
    if (url === null || (patch.url !== undefined && record.kind !== "bookmark")) throw new Error("A bookmark URL must be HTTP(S).");
    Object.assign(record, patch, { url });
    this.store.write(this.records);
  }
  remove(profileId: string, id: string): void {
    if (!this.records.some((b) => b.profileId === profileId && b.id === id)) throw new Error("Bookmark not found in this Workspace.");
    const ids = new Set([id]);
    let size = 0;
    while (size !== ids.size) {
      size = ids.size;
      for (const item of this.records) if (item.profileId === profileId && item.parentId && ids.has(item.parentId)) ids.add(item.id);
    }
    this.records = this.records.filter((b) => b.profileId !== profileId || !ids.has(b.id));
    this.store.write(this.records);
  }
  import(profileId: string, html: string): number {
    const rows = importBookmarks(html);
    const ids = new Map(rows.map((row) => [row.key, randomUUID()]));
    const records: Bookmark[] = rows.map((row) => ({ id: ids.get(row.key)!, parentId: row.parentKey === null ? null : ids.get(row.parentKey) ?? null, profileId, title: row.title, url: row.url, kind: row.url ? "bookmark" : "folder", createdAt: Date.now() }));
    this.records.push(...records);
    this.store.write(this.records);
    return records.length;
  }
}
