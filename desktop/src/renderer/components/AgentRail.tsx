import { AGENT_IPC } from "@shared/ipc";
import { ChevronUp } from "lucide-react";
import { useState } from "react";
import {
  Message,
  MessageContent,
  MessageScroller,
} from "@/components/agents/message";
import { PromptInput } from "@/components/agents/prompt-input";

type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

interface ChatMessage {
  from: "user" | "assistant";
  text: string;
}

export function AgentRail({
  invoke,
  defaultOpen = false,
}: {
  invoke: Invoke;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const send = async (text: string) => {
    const value = text.trim();
    if (!value) return;
    setMessages((rows) => [...rows, { from: "user", text: value }]);
    setLoading(true);
    try {
      let sid = sessionId;
      if (!sid) {
        const created = (await invoke(AGENT_IPC.newSession)) as {
          value?: { id?: string };
          id?: string;
        } | null;
        sid = created?.value?.id ?? created?.id ?? null;
        setSessionId(sid);
      }
      const result = (await invoke(AGENT_IPC.prompt, {
        sessionId: sid,
        text: value,
      })) as { value?: { text?: string }; text?: string } | null;
      const reply =
        result?.value?.text ?? result?.text ?? "The agent returned no text.";
      setMessages((rows) => [...rows, { from: "assistant", text: reply }]);
    } catch (error) {
      setMessages((rows) => [
        ...rows,
        {
          from: "assistant",
          text: `Agent unavailable: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="shrink-0 border-t border-border">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span>Agent</span>
        <ChevronUp
          className={`size-3.5 transition-transform ${open ? "" : "rotate-180"}`}
        />
      </button>
      {open ? (
        <div className="flex h-72 min-h-0 flex-col gap-2 border-t border-border p-2">
          <MessageScroller busy={loading} className="min-h-0 flex-1">
            {messages.length === 0 ? (
              <p className="p-3 text-[11px] text-muted-foreground">
                Ask the agent to act on the current page.
              </p>
            ) : (
              messages.map((message, index) => (
                <Message from={message.from} key={index}>
                  <MessageContent>{message.text}</MessageContent>
                </Message>
              ))
            )}
          </MessageScroller>
          <PromptInput
            loading={loading}
            maxRows={5}
            minRows={1}
            onStop={() => void invoke(AGENT_IPC.abort, { sessionId })}
            onSubmit={(value) => void send(value)}
            placeholder="Message the agent…"
          />
        </div>
      ) : null}
    </section>
  );
}
