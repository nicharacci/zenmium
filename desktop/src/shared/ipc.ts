import { z } from "zod";

/**
 * Arc-model IPC contract. The main-process ArcCore owns the model and the
 * Chromium views; the renderer is a pure view of `ArcState` plus commands.
 */

export const ARC_STATE_EVENT = "arc:state" as const;

/** Renderer-side mirrors of the main-process agent kernel channels. */
export const AGENT_IPC = {
  abort: "agent:abort",
  event: "agent:event",
  newSession: "agent:newSession",
  prompt: "agent:prompt",
} as const;

export const ARC_IPC = {
  activateSpace: "arc:activateSpace",
  activateTab: "arc:activateTab",
  archiveTab: "arc:archiveTab",
  back: "arc:back",
  clearArchive: "arc:clearArchive",
  clearHistory: "arc:clearHistory",
  closePeek: "arc:closePeek",
  closeTab: "arc:closeTab",
  createFolder: "arc:createFolder",
  createSpace: "arc:createSpace",
  deleteFolder: "arc:deleteFolder",
  deleteSpace: "arc:deleteSpace",
  forward: "arc:forward",
  moveTabToSpace: "arc:moveTabToSpace",
  moveToFolder: "arc:moveToFolder",
  navigate: "arc:navigate",
  newTab: "arc:newTab",
  openPeek: "arc:openPeek",
  pinTab: "arc:pinTab",
  promotePeek: "arc:promotePeek",
  reload: "arc:reload",
  renameFolder: "arc:renameFolder",
  reorderTab: "arc:reorderTab",
  resetTab: "arc:resetTab",
  restoreTab: "arc:restoreTab",
  setContentBounds: "arc:setContentBounds",
  snapshot: "arc:snapshot",
  stop: "arc:stop",
  toggleSplit: "arc:toggleSplit",
  unpinTab: "arc:unpinTab",
  updateFolder: "arc:updateFolder",
  updateSpace: "arc:updateSpace",
  updateTab: "arc:updateTab",
} as const;

export const rectSchema = z.object({
  height: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});
export type Rect = z.infer<typeof rectSchema>;

export type TabKind = "pinned" | "today";

export interface Space {
  id: string;
  name: string;
  color: string;
  icon: string;
  /** First account identity observed for this Workspace; only display-safe initials persist. */
  avatar?: WorkspaceAvatar;
  pinnedCollapsed?: boolean;
  /** Stable browser identity; names and theme changes never change a partition. */
  profileId?: string;
}

export interface WorkspaceAvatar {
  initials: string;
  provider: "google" | "microsoft" | "apple" | "github" | "other";
}

export interface BrowserProfile {
  id: string;
  /** Empty only for the one migrated legacy Chromium default session. */
  partition: string;
}

export interface NewTabOptions {
  spaceId?: string;
  url?: string;
  kind?: TabKind;
  background?: boolean;
  ownerSessionId?: string;
}

export type TabMoveResult =
  | { status: "moved" | "unchanged"; tabId: string; spaceId: string }
  | {
      status: "confirmation-required";
      tabId: string;
      spaceId: string;
      reason: string;
    };

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
  customTitle?: string;
  faviconUrl?: string;
  pinnedUrl?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  error?: string | null;
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
  /** Agent-session ownership is main-process assigned, never a TabUpdate field. */
  ownerSessionId?: string;
  /** User/OS-selected local HTML/PDF document; never writable through TabUpdate. */
  localFile?: boolean;
}

export interface TabUpdate {
  title?: string;
  customTitle?: string | null;
  pinnedUrl?: string;
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
  localFile?: boolean;
}

export interface ArcState {
  schemaVersion?: number;
  profiles?: BrowserProfile[];
  spaces: Space[];
  activeSpaceId: string;
  activeTabId: string | null;
  /** The other visible pane, regardless of which pane currently has focus. */
  splitTabId: string | null;
  /** Stable left pane. Older snapshots default to activeTabId on the left. */
  splitPrimaryTabId?: string | null;
  folders: Folder[];
  tabs: Tab[];
  archive: ArchiveEntry[];
  history?: HistoryEntry[];
  glance?: { url: string; title: string; spaceId?: string } | null;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  /** Optional only to read pre-profile snapshots; normalized before use. */
  spaceId?: string;
}

/** Physical pane order is independent of the active navigation/keyboard target. */
export function getPaneTabIds(state: ArcState): string[] {
  const { activeTabId, splitTabId, splitPrimaryTabId } = state;
  if (!activeTabId) return [];
  if (!splitTabId || splitTabId === activeTabId) return [activeTabId];
  return splitPrimaryTabId === splitTabId
    ? [splitTabId, activeTabId]
    : [activeTabId, splitTabId];
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
/** Sidebar presentation capacity, not a storage cap. Further pins use overflow. */
export const MAX_ESSENTIALS = 8;

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; seam: string; reason: string };

export interface ZenmiumBridge {
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

export const emptyState = (): ArcState => ({
  activeSpaceId: "",
  activeTabId: null,
  archive: [],
  folders: [],
  glance: null,
  history: [],
  spaces: [],
  splitPrimaryTabId: null,
  splitTabId: null,
  tabs: [],
});
