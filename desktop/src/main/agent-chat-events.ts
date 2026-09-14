import type { ChatActivity } from "../shared/agent-chat";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
const string = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

export type NormalizedChatEvent =
  | { kind: "message"; sessionId: string; messageId: string; role: "user" | "assistant"; completed: boolean; failed: boolean }
  | { kind: "text"; sessionId: string; messageId: string; partId: string; text: string; delta: boolean }
  | { kind: "activity"; sessionId: string; activity: ChatActivity }
  | { kind: "status"; sessionId: string; status: "running" | "idle" | "error" | "permission" }
  | { kind: "remove"; sessionId: string; messageId: string; partId?: string };

/** Accept SDK v1/v2 SSE envelopes. Never forward tool arguments, outputs, reasoning, or raw errors. */
export function normalizeChatEvent(input: unknown): NormalizedChatEvent | null {
  let event = record(input);
  if (event.data) event = record(event.data);
  if (event.payload) event = record(event.payload);
  const props = record(event.properties);
  const part = record(props.part);
  const info = record(props.info);
  const sessionId = string(part.sessionID) ?? string(info.sessionID) ?? string(props.sessionID);
  if (!sessionId) return null;
  const messageId = string(part.messageID) ?? string(info.id) ?? string(props.messageID);
  if (event.type === "message.updated" && messageId && ["user", "assistant"].includes(String(info.role))) {
    return { kind: "message", sessionId, messageId, role: info.role as "user" | "assistant", completed: typeof record(info.time).completed === "number", failed: Boolean(info.error) };
  }
  if (event.type === "message.part.updated" && messageId && typeof part.id === "string") {
    if (part.type === "text" && typeof part.text === "string") {
      // The full part is authoritative. `properties.delta` accompanies it in SDK v1; appending both duplicates text.
      return { kind: "text", sessionId, messageId, partId: part.id, text: part.text, delta: false };
    }
    if (part.type === "tool") {
      const state = record(part.state);
      const tool = string(part.tool)?.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 100) ?? "Browser action";
      return { kind: "activity", sessionId, activity: { id: part.id, label: tool, status: state.status === "completed" ? "complete" : state.status === "error" ? "error" : "running", at: Date.now() } };
    }
  }
  if (event.type === "message.part.delta" && messageId && props.field === "text" && typeof props.partID === "string" && typeof props.delta === "string") {
    return { kind: "text", sessionId, messageId, partId: props.partID, text: props.delta, delta: true };
  }
  if (event.type === "session.idle" || event.type === "session.status") {
    return { kind: "status", sessionId, status: event.type === "session.idle" || record(props.status).type === "idle" ? "idle" : "running" };
  }
  if (event.type === "session.error") return { kind: "status", sessionId, status: "error" };
  if (event.type === "permission.updated" || event.type === "permission.asked" || event.type === "question.asked") return { kind: "status", sessionId, status: "permission" };
  if ((event.type === "message.removed" || event.type === "message.part.removed") && messageId) {
    return { kind: "remove", sessionId, messageId, partId: string(props.partID) };
  }
  return null;
}
