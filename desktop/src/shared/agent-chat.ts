import { z } from "zod";

/** Versioned chat API. Runtime IDs and attachment bytes never originate in the renderer. */
export const CHAT_IPC = {
  list: "agent:chat:list",
  get: "agent:chat:get",
  create: "agent:chat:create",
  prompt: "agent:chat:prompt",
  abort: "agent:chat:abort",
  retry: "agent:chat:retry",
  resume: "agent:chat:resume",
  rename: "agent:chat:rename",
  models: "agent:chat:models",
  context: "agent:chat:context",
  attach: "agent:chat:attach",
  removeAttachment: "agent:chat:remove-attachment",
  takeover: "agent:chat:takeover",
  event: "agent:chat:event",
} as const;

export const CHAT_LIMITS = { attachmentBytes: 10 * 1024 * 1024, attachments: 8, text: 100_000, pageText: 24_000 } as const;
const id = z.string().min(1).max(160);
export const conversationInput = z.object({ conversationId: id });
export const createChatInput = z.object({ spaceId: id, title: z.string().trim().max(120).optional() });
export const promptChatInput = conversationInput.extend({
  requestId: id,
  text: z.string().trim().min(1).max(CHAT_LIMITS.text),
  model: z.string().min(1).max(300).optional(),
  attachmentIds: z.array(id).max(CHAT_LIMITS.attachments).default([]),
  contextIds: z.array(id).max(16).default([]),
});
export type ChatPromptInput = z.input<typeof promptChatInput>;

export interface ChatModel {
  id: string;
  name: string;
  providerId: string;
  modelId: string;
  available: boolean;
  attachments: boolean;
  inputModalities: string[];
}
export interface ChatAttachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
}
export interface ChatContext {
  id: string;
  kind: "page" | "bookmark";
  spaceId: string;
  tabId?: string;
  title: string;
  url: string;
  capturedAt: number;
  /** A safe, main-process observation, never renderer-supplied page content. */
  text: string;
}
export interface ChatMessage {
  id: string;
  from: "user" | "assistant";
  text: string;
  createdAt: number;
  status: "streaming" | "complete" | "error" | "stopped";
  attachments?: ChatAttachment[];
  sources?: Array<Pick<ChatContext, "title" | "url" | "tabId">>;
  /** Text-part IDs preserve replay-safe ordering without exposing raw tool payloads. */
  parts?: Record<string, string>;
}
export interface ChatActivity {
  id: string;
  label: string;
  status: "running" | "complete" | "error";
  at: number;
}
export type ChatStatus = "idle" | "starting" | "running" | "stopped" | "interrupted" | "error";
export interface ChatConversation {
  id: string;
  spaceId: string;
  title: string;
  updatedAt: number;
  revision: number;
  status: ChatStatus;
  model?: string;
  messages: ChatMessage[];
  activity: ChatActivity[];
  reason?: string;
  feedback?: Record<string, "up" | "down" | null>;
}
export interface ChatHistorySummary {
  id: string;
  spaceId: string;
  title: string;
  updatedAt: number;
  status: ChatStatus;
}
export interface ChatChange {
  version: 1;
  sequence: number;
  conversation: ChatConversation;
}
export type ChatResult<T> = { ok: true; value: T } | { ok: false; seam: "agent"; reason: string };
export const chatFailure = (reason: string): ChatResult<never> => ({ ok: false, seam: "agent", reason });

export function chatIsBusy(status?: ChatStatus): boolean {
  return status === "starting" || status === "running";
}

/** Keep sources navigable without propagating credentials, query tokens, or URL fragments. */
export function safeChatUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return null; }
}

/** Defence in depth, not a substitute for the browser's credential-safe observation API. */
export function redactChatText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ghp|github_pat|op)_[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/((?:password|passwd|secret|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|one[- ]time(?: password| code)?|totp|otp)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]");
}
