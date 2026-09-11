import { useState } from "react";

type AgentState = "idle" | "working" | "blocked" | "done";

/**
 * Collapsible bottom half of the shared sidebar. The BeUI Chat App mounts in this surface,
 * driven by the OpenCode kernel over the agent IPC channels.
 */
export function AgentRail() {
  const [open, setOpen] = useState(false);
  const [state] = useState<AgentState>("idle");

  return (
    <section className="shrink-0 border-t border-white/10">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Toggle agent rail"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] text-[var(--gp-muted)] hover:text-[var(--gp-ink)]"
      >
        <span>Agent · {state}</span>
        <span
          aria-hidden
          className="inline-block transition-transform duration-150"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        >
          ▾
        </span>
      </button>
      {open ? (
        <div className="flex h-72 flex-col gap-2 border-t border-white/10 px-3 py-2">
          <div className="min-h-0 flex-1 rounded-md border border-white/10 bg-black/20" data-agent-rail-body="">
            <p className="p-3 text-[11px] text-[var(--gp-muted)]">Agent surface mounts here.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
