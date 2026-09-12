import { useEffect } from "react";
import { ARC_IPC, type ArcState } from "@shared/ipc";

type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

/** Arc keyboard map. */
export function useShortcuts({
  state,
  invoke,
  openCommand,
}: {
  state: ArcState;
  invoke: Invoke;
  openCommand: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      const active = state.tabs.find((t) => t.id === state.activeTabId) ?? null;
      const spaceTabs = state.tabs.filter((t) => t.spaceId === state.activeSpaceId);
      const spaceIndex = state.spaces.findIndex((s) => s.id === state.activeSpaceId);

      if (key === "t" && !event.shiftKey) {
        event.preventDefault();
        openCommand();
      } else if (key === "w") {
        event.preventDefault();
        if (active) void invoke(ARC_IPC.closeTab, active.id);
      } else if (key === "d") {
        event.preventDefault();
        if (active) void invoke(active.kind === "pinned" ? ARC_IPC.unpinTab : ARC_IPC.pinTab, active.id);
      } else if (key === "l") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("[data-address-input]")?.focus();
      } else if (key === "k" && event.shiftKey) {
        event.preventDefault();
        for (const tab of state.tabs.filter((t) => t.kind === "today")) void invoke(ARC_IPC.archiveTab, tab.id);
      } else if (key === "t" && event.shiftKey) {
        event.preventDefault();
        const last = state.archive[0];
        if (last) void invoke(ARC_IPC.restoreTab, last.id);
      } else if (event.altKey && key === "arrowleft") {
        event.preventDefault();
        if (spaceIndex > 0) void invoke(ARC_IPC.activateSpace, state.spaces[spaceIndex - 1]!.id);
      } else if (event.altKey && key === "arrowright") {
        event.preventDefault();
        if (spaceIndex < state.spaces.length - 1) void invoke(ARC_IPC.activateSpace, state.spaces[spaceIndex + 1]!.id);
      } else if (/^[1-9]$/.test(key)) {
        event.preventDefault();
        const target = spaceTabs[Number(key) - 1];
        if (target) void invoke(ARC_IPC.activateTab, target.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, invoke, openCommand]);
}
