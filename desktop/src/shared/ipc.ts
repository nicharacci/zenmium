import { z } from "zod";

/**
 * Arc-model IPC contract. The main-process ArcCore owns the model and the
 * Chromium views; the renderer is a pure view of `ArcState` plus commands.
 */

export const ARC_STATE_EVENT = "arc:state" as const;

/** Renderer-side mirrors of the main-process agent kernel channels. */
export const AGENT_IPC = {
  newSession: "agent:newSession",
  prompt: "agent:prompt",
  abort: "agent:abort",
  event: "agent:event",
} as const;

export const ARC_IPC = {
  snapshot: "arc:snapshot",
  createSpace: "arc:createSpace",
  activateSpace: "arc:activateSpace",
  updateSpace: "arc:updateSpace",
  deleteSpace: "arc:deleteSpace",
  newTab: "arc:newTab",
  closeTab: "arc:closeTab",
  activateTab: "arc:activateTab",
  updateTab: "arc:updateTab",
  navigate: "arc:navigate",
  back: "arc:back",
  forward: "arc:forward",
  reload: "arc:reload",
  pinTab: "arc:pinTab",
  unpinTab: "arc:unpinTab",
  createFolder: "arc:createFolder",
  renameFolder: "arc:renameFolder",
  deleteFolder: "arc:deleteFolder",
  moveToFolder: "arc:moveToFolder",
  reorderTab: "arc:reorderTab",
  archiveTab: "arc:archiveTab",
  restoreTab: "arc:restoreTab",
  clearArchive: "arc:clearArchive",
  toggleSplit: "arc:toggleSplit",
  openPeek: "arc:openPeek",
  setContentBounds: "arc:setContentBounds",
} as const;

export const rectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});
export type Rect = z.infer<typeof rectSchema>;

export type TabKind = "pinned" | "today";

export interface Space {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface Folder {
  id: string;
  spaceId: string;
  name: string;
  collapsed: boolean;
}

export interface Tab {
  id: string;
  spaceId: string;
  kind: TabKind;
  url: string;
  title: string;
  loading: boolean;
  folderId: string | null;
  lastActiveAt: number;
  /** Optional Zen presentation state, persisted by ArcCore when present. */
  iconUrl?: string;
  originalIconUrl?: string;
  pinnedChanged?: boolean;
  audio?: boolean;
  muted?: boolean;
  blocked?: boolean;
  discarded?: boolean;
  glance?: boolean;
  containerColor?: string | null;
  sublabel?: string | null;
}

export interface TabUpdate {
  title?: string;
  url?: string;
  iconUrl?: string | null;
  originalIconUrl?: string | null;
  pinnedChanged?: boolean;
  audio?: boolean;
  muted?: boolean;
  blocked?: boolean;
  discarded?: boolean;
  glance?: boolean;
  containerColor?: string | null;
  sublabel?: string | null;
}

export interface ArchiveEntry {
  id: string;
  spaceId: string;
  url: string;
  title: string;
  archivedAt: number;
}

export interface ArcState {
  spaces: Space[];
  activeSpaceId: string;
  activeTabId: string | null;
  splitTabId: string | null;
  folders: Folder[];
  tabs: Tab[];
  archive: ArchiveEntry[];
}

export const SPACE_COLORS = [
  "#6ee7a8",
  "#8ab4f8",
  "#f6a5c0",
  "#f5c26b",
  "#c4a7f5",
  "#7fd6d6",
  "#f58f8f",
] as const;

export type Result<T> = { ok: true; value: T } | { ok: false; seam: string; reason: string };

export interface ZenmiumBridge {
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

export const emptyState = (): ArcState => ({
  spaces: [],
  activeSpaceId: "",
  activeTabId: null,
  splitTabId: null,
  folders: [],
  tabs: [],
  archive: [],
});
