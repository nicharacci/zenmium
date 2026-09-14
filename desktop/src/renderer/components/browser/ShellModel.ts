/** Pure shell transitions. Chat streaming is deliberately not browser activity. */
export interface ControlActivity {
  epoch: string;
  cursor: number;
  requests: Map<string, string>;
}

export function updateControlActivity(current: ControlActivity, value: unknown): ControlActivity {
  if (!value || typeof value !== "object") return current;
  const event = value as Record<string, unknown>;
  if (event.version !== 1 || typeof event.epoch !== "string" ||
      typeof event.cursor !== "number" || typeof event.sessionId !== "string") return current;
  if (current.epoch === event.epoch && event.cursor <= current.cursor) return current;
  const requests = current.epoch === event.epoch ? new Map(current.requests) : new Map<string, string>();
  if (event.type === "activity" && typeof event.requestId === "string") {
    const key = `${event.sessionId}:${event.requestId}`;
    if (event.active === true) requests.set(key, event.sessionId);
    if (event.active === false) requests.delete(key);
  } else if (event.type === "ownership") {
    for (const [key, session] of requests) {
      if (session === event.sessionId) requests.delete(key);
    }
  }
  return { epoch: event.epoch, cursor: event.cursor, requests };
}
