import { z } from "zod";

/**
 * Browser-side IPC contract shared by main and renderer.
 *
 * Engine-agnostic on purpose: main implements it (browser-core), the preload bridges it,
 * the renderer consumes it. The extension and agent channels live in their own modules and
 * are wired in main/index.ts.
 */

export const BROWSER_EVENT_CHANNEL = "browser:event" as const;

export const BROWSER_IPC = {
  createTab: "browser:createTab",
  closeTab: "browser:closeTab",
  activateTab: "browser:activateTab",
  navigate: "browser:navigate",
  back: "browser:back",
  forward: "browser:forward",
  reload: "browser:reload",
  setContentBounds: "browser:setContentBounds",
  list: "browser:list",
} as const;

export const rectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});
export type Rect = z.infer<typeof rectSchema>;

export const browserTabSchema = z.object({
  id: z.string().min(1),
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
});
export type BrowserTab = z.infer<typeof browserTabSchema>;

export const navigatePayloadSchema = z.object({ id: z.string().min(1), url: z.string().min(1) });
export const tabIdPayloadSchema = z.object({ id: z.string().min(1) });

export type BrowserEvent =
  | { type: "tabs"; tabs: BrowserTab[]; activeId: string | null }
  | { type: "active"; activeId: string | null }
  | { type: "loading"; id: string; loading: boolean }
  | { type: "url"; id: string; url: string };

export type Result<T> = { ok: true; value: T } | { ok: false; seam: string; reason: string };

export interface ZenmiumBridge {
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}
