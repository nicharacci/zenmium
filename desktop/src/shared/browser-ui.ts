import { z } from "zod";
import type { ArcState, Rect } from "./ipc";

export const CHROME_IPC = {
  close: "chrome:close",
  command: "chrome:command",
  commandEvent: "chrome:command-event",
  downloadAction: "browser:download-action",
  downloads: "browser:downloads",
  event: "chrome:state",
  extensionEnabled: "extensions:setEnabled",
  extensionLoad: "extensions:choose-directory",
  extensions: "extensions:list",
  migratePreferences: "chrome:migrate-preferences",
  open: "chrome:open",
  preferences: "chrome:preferences",
  sidebar: "chrome:sidebar",
  snapshot: "chrome:snapshot",
  windowAction: "chrome:window-action",
} as const;

export const preferencesSchema = z.object({
  bookmarksBar: z.boolean().default(false),
  newTabAtTop: z.boolean().default(true),
  searchEngine: z.enum(["duckduckgo", "google"]).default("duckduckgo"),
  side: z.enum(["left", "right"]).default("left"),
  sidebarMode: z.enum(["expanded", "collapsed", "compact"]).default("expanded"),
  theme: z.enum(["dark", "light", "system"]).default("dark"),
  width: z.number().int().min(200).max(420).default(230),
});
export type BrowserPreferences = z.infer<typeof preferencesSchema>;
export const DEFAULT_PREFERENCES: BrowserPreferences = preferencesSchema.parse(
  {}
);
/** One-time migration from the prior sidebar renderer; absent keys stay absent. */
export function legacyPreferences(
  values: Record<string, string | null>
): Partial<BrowserPreferences> {
  const patch: Partial<BrowserPreferences> = {};
  if (values.compact === "true") patch.sidebarMode = "compact";
  else if (values.expanded === "false") patch.sidebarMode = "collapsed";
  else if (values.expanded === "true" || values.compact === "false")
    patch.sidebarMode = "expanded";
  if (values.side === "left" || values.side === "right")
    patch.side = values.side;
  if (
    values.width !== null &&
    values.width !== undefined &&
    values.width.trim()
  ) {
    const width = Number(values.width);
    if (Number.isFinite(width) && width >= 180 && width <= 420)
      patch.width = Math.max(200, Math.round(width));
  }
  if (values.newTabTop === "true" || values.newTabTop === "false")
    patch.newTabAtTop = values.newTabTop === "true";
  return patch;
}
export type PanelKind =
  | "address"
  | "new-tab"
  | "menu"
  | "tab-menu"
  | "workspace"
  | "workspace-edit"
  | "history"
  | "downloads"
  | "extensions"
  | "settings"
  | "agent"
  | "commands"
  | "site-info";
export interface BrowserOverlayState {
  kind: PanelKind;
  tabId?: string;
  spaceId?: string;
  x?: number;
  y?: number;
  sessionId?: number;
}
export interface SidebarInteraction {
  hovered: boolean;
  focused: boolean;
  dragging: boolean;
}
export interface BrowserUiState {
  preferences: BrowserPreferences;
  sidebar: SidebarInteraction;
  overlay: BrowserOverlayState | null;
  dark: boolean;
}
export interface DownloadRecord {
  id: string;
  filename: string;
  url: string;
  path: string;
  received: number;
  total: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  paused: boolean;
  startedAt: number;
}
export interface BrowserExtension {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}
export type Invoke = <T = unknown>(
  channel: string,
  payload?: unknown
) => Promise<T>;
export interface BrowserSurfaceProps {
  state: ArcState;
  ui: BrowserUiState;
  invoke: Invoke;
}

export function sidebarRevealed(ui: BrowserUiState): boolean {
  return (
    ui.preferences.sidebarMode === "expanded" ||
    ui.sidebar.hovered ||
    ui.sidebar.focused ||
    ui.sidebar.dragging ||
    (ui.overlay !== null &&
      ui.overlay.kind !== "address" &&
      ui.overlay.kind !== "new-tab")
  );
}

/** The same geometry is used for CSS cards and native Chromium view bounds. */
export function browserLayout(
  width: number,
  height: number,
  ui: BrowserUiState
): { sidebar: Rect; content: Rect } {
  const { preferences: p } = ui;
  const gutter = 8;
  const docked = p.sidebarMode === "expanded";
  const expanded = sidebarRevealed(ui);
  const railWidth = expanded ? p.width : p.sidebarMode === "collapsed" ? 60 : 0;
  const sidebarWidth = railWidth + gutter * 2;
  const reserved = docked
    ? p.width + gutter
    : p.sidebarMode === "collapsed"
      ? 68
      : 0;
  return {
    content: {
      height: Math.max(0, height - gutter * 2 - (p.bookmarksBar ? 30 : 0)),
      width: Math.max(0, width - reserved - gutter * 2),
      x: gutter + (p.side === "left" ? reserved : 0),
      y: gutter + (p.bookmarksBar ? 30 : 0),
    },
    sidebar: {
      height,
      width: railWidth ? sidebarWidth : gutter,
      x:
        p.side === "left"
          ? 0
          : Math.max(0, width - (railWidth ? sidebarWidth : gutter)),
      y: 0,
    },
  };
}

export function glanceLayout(
  width: number,
  height: number
): { frame: Rect; page: Rect } {
  const w = Math.max(0, Math.round(width * 0.8));
  const h = Math.max(0, height - 16);
  const x = Math.round((width - w) / 2),
    y = Math.round((height - h) / 2);
  const frame = { height: h, width: w, x, y };
  return { frame, page: { ...frame } };
}
