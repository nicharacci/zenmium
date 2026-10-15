import { z } from "zod";

/** Host-neutral v1 contract. IDs are opaque; credentials never belong in commands. */
export const BROWSER_CONTROL_VERSION = 1 as const;
export const CONTROL_IPC = {
  pair: "browser-control:pair",
  revoke: "browser-control:revoke",
  grants: "browser-control:grants",
  createSession: "browser-control:create-session",
  execute: "browser-control:execute",
  takeover: "browser-control:takeover",
  resume: "browser-control:resume",
  events: "browser-control:events",
  event: "browser-control:event",
  status: "browser-control:status",
} as const;

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/);
export const controlCapabilitySchema = z.enum([
  "observe", "navigate", "interact", "tabs", "downloads", "authenticate", "cdp",
]);
export type ControlCapability = z.infer<typeof controlCapabilitySchema>;
export const controlGrantSchema = z.object({
  actorId: identifier,
  workspaceIds: z.array(identifier).min(1).max(100),
  capabilities: z.array(controlCapabilitySchema).min(1),
  authorizedTabIds: z.array(identifier).max(100).default([]),
  allowAdditionalTabs: z.boolean().default(false),
  ttlMs: z.number().int().min(1000).max(8 * 60 * 60 * 1000).default(60 * 60 * 1000),
}).strict();
export type ControlGrantInput = z.input<typeof controlGrantSchema>;
export interface ControlGrantSummary {
  grantId: string;
  actorId: string;
  workspaceIds: string[];
  capabilities: ControlCapability[];
  authorizedTabIds: string[];
  allowAdditionalTabs: boolean;
  expiresAt: number;
  revoked: boolean;
}
export const controlSessionInputSchema = z.object({
  requestId: identifier,
  workspaceId: identifier,
  conversationId: identifier.optional(),
  title: z.string().trim().min(1).max(100).default("Agent session"),
}).strict();
export type ControlSessionInput = z.input<typeof controlSessionInputSchema>;
export interface BrowserControlSession {
  id: string;
  actorId: string;
  workspaceId: string;
  profileId: string;
  browserSessionId: string;
  conversationId?: string;
  groupId: string;
  tabIds: string[];
  primaryTabId: string;
  revision: number;
  fence: number;
  controller: "agent" | "human";
  needsObservation: boolean;
  createdAt: number;
}

const common = {
  version: z.literal(BROWSER_CONTROL_VERSION),
  requestId: identifier,
  sessionId: identifier,
};
const target = { ...common, tabId: identifier };
const mutation = { ...target, expectedRevision: z.number().int().nonnegative() };
const webUrl = z.string().url().max(8192).refine((value) => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
}, "Only HTTP(S) destinations without URL credentials are supported.");
const elementRef = z.string().min(1).max(100).regex(/^el_[a-zA-Z0-9_-]+$/);
export const browserControlCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...target, action: z.literal("observe") }).strict(),
  z.object({ ...common, action: z.literal("session.status") }).strict(),
  z.object({ ...mutation, action: z.literal("navigate"), url: webUrl }).strict(),
  z.object({ ...mutation, action: z.literal("click"), ref: elementRef }).strict(),
  z.object({ ...mutation, action: z.literal("fill"), ref: elementRef, text: z.string().max(20000) }).strict(),
  z.object({ ...mutation, action: z.literal("press"), ref: elementRef, key: z.enum(["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Space"]) }).strict(),
  z.object({ ...mutation, action: z.literal("scroll"), deltaX: z.number().int().min(-4000).max(4000).default(0), deltaY: z.number().int().min(-4000).max(4000) }).strict(),
  z.object({ ...mutation, action: z.literal("tab.close") }).strict(),
  z.object({ ...common, expectedRevision: z.number().int().nonnegative(), action: z.literal("tab.create"), url: webUrl.optional() }).strict(),
  z.object({ ...mutation, action: z.literal("tab.adopt") }).strict(),
  z.object({ ...mutation, action: z.literal("download"), url: webUrl }).strict(),
  z.object({ ...mutation, action: z.literal("authenticate"), origin: z.string().url().max(2048), includeTotp: z.boolean().default(true) }).strict(),
  z.object({ ...mutation, action: z.literal("cdp"), method: z.literal("Page.navigate"), params: z.object({ url: webUrl }).strict() }).strict(),
  z.object({ ...target, action: z.literal("cdp.target") }).strict(),
]);
export type BrowserControlCommand = z.infer<typeof browserControlCommandSchema>;
export type ControlReceiptStatus = "accepted" | "observed" | "failed" | "uncertain";
export interface ControlElement {
  ref: string;
  role: string;
  name: string;
  disabled: boolean;
  editable: boolean;
}
export interface BrowserObservation {
  tabId: string;
  url: string;
  title: string;
  text: string;
  documentId: string;
  elements: ControlElement[];
  authenticationRequired: boolean;
  redacted: boolean;
  unsupportedFrames: boolean;
  revision: number;
}
export interface BrowserControlReceipt {
  version: 1;
  requestId: string;
  sessionId: string;
  action: BrowserControlCommand["action"];
  status: ControlReceiptStatus;
  revision: number;
  code?: string;
  message?: string;
  result?: BrowserObservation | BrowserControlSession | Record<string, unknown>;
}
export interface BrowserControlEvent {
  version: 1;
  epoch: string;
  cursor: number;
  sessionId: string;
  actorId: string;
  type: "activity" | "receipt" | "ownership" | "session";
  active?: boolean;
  requestId?: string;
  action?: BrowserControlCommand["action"];
  revision: number;
  status?: ControlReceiptStatus;
  at: number;
}
export interface ControlEventPage {
  epoch: string;
  cursor: number;
  resetRequired: boolean;
  events: BrowserControlEvent[];
}
export interface BrowserControlCapabilities {
  version: 1;
  singleWindow: true;
  backgroundTabs: true;
  interactiveNativeSession: true;
  presentation: "native-host-bounds";
  cdpMethods: readonly ["Page.navigate", "Target.getTargetInfo"];
  unavailable: string[];
}
export interface AuthenticationRequest {
  actorId: string;
  sessionId: string;
  workspaceId: string;
  profileId: string;
  tabId: string;
  origin: string;
  includeTotp: boolean;
  signal: AbortSignal;
}
export interface AuthenticationOutcome {
  status: "filled" | "awaiting-user" | "denied" | "unavailable" | "cancelled" | "expired";
}
