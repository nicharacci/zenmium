import type { Invoke } from "@shared/browser-ui";
import {
  ARC_IPC,
  MAX_ESSENTIALS,
  type ArcState,
  type Tab,
  type TabMoveResult,
} from "@shared/ipc";
import type { DragEvent } from "react";
import { useRef, useState } from "react";

export { MAX_ESSENTIALS };
const TAB_MIME = "application/x-zenmium-tab";
export interface TabDestination {
  beforeId?: string | null;
  folderId?: string | null;
  kind?: Tab["kind"];
  spaceId: string;
}

export const isEssentialTab = (tab: Tab) =>
  tab.kind === "pinned" && !tab.folderId;

/** Eight is a presentation capacity; additional saved pins must remain droppable. */
export function canDropTab(
  _state: ArcState,
  _tab: Tab,
  _destination: TabDestination
) {
  return true;
}

/** Movement changes membership before ordering; folder moves implicitly pin in ArcCore. */
export async function moveSidebarTab(
  invoke: Invoke,
  tab: Tab,
  destination: TabDestination,
  options: { confirmReload?: boolean } = {}
) {
  const changingSpace = tab.spaceId !== destination.spaceId;
  let { kind } = tab;
  if (changingSpace) {
    // Do not unpin or reorder before the native profile boundary accepts the
    // move. Declining its reload warning must leave the original tab intact.
    const result = await invoke<TabMoveResult>("arc:moveTabToSpace", {
      id: tab.id,
      spaceId: destination.spaceId,
      ...(options.confirmReload ? { confirmReload: true } : {}),
    });
    if (result?.status === "confirmation-required") return result;
  }
  if (kind === "pinned" && destination.kind === "today") {
    await invoke(ARC_IPC.unpinTab, tab.id);
    kind = "today";
  }
  if (destination.folderId) {
    // moveToFolder pins directly, so it also works when essentials are full.
    await invoke(ARC_IPC.moveToFolder, {
      folderId: destination.folderId,
      id: tab.id,
    });
  } else if (
    destination.kind === "pinned" &&
    (kind === "today" || (tab.folderId && !changingSpace))
  ) {
    await invoke(ARC_IPC.pinTab, tab.id);
  } else if (destination.folderId === null && tab.folderId && !changingSpace) {
    await invoke(ARC_IPC.moveToFolder, { folderId: null, id: tab.id });
  }
  if (destination.beforeId !== undefined) {
    await invoke(ARC_IPC.reorderTab, {
      beforeId: destination.beforeId,
      id: tab.id,
    });
  }
}

export function useSidebarDrag(
  state: ArcState,
  invoke: Invoke,
  setDragging: (value: boolean) => void
) {
  const sourceId = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [over, setOver] = useState<{
    id: string;
    position: "before" | "after" | "inside";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ tabId: string; destination: TabDestination; reason: string } | null>(null);
  const [moving, setMoving] = useState(false);

  const clear = () => {
    sourceId.current = null;
    setDraggingId(null);
    setOver(null);
    setDragging(false);
  };

  const source = (event: DragEvent) =>
    state.tabs.find(
      (tab) =>
        tab.id === (sourceId.current || event.dataTransfer.getData(TAB_MIME))
    );
  const canRead = (event: DragEvent) =>
    !!sourceId.current || event.dataTransfer.types.includes(TAB_MIME);
  const begin = (event: DragEvent, tab: Tab) => {
    event.stopPropagation();
    sourceId.current = tab.id;
    setDraggingId(tab.id);
    setError(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TAB_MIME, tab.id);
    event.dataTransfer.setData("text/plain", tab.id);
    setDragging(true);
  };

  const accept = (event: DragEvent, destination: TabDestination) => {
    event.stopPropagation();
    if (!canRead(event)) {
      return false;
    }
    const tab = source(event);
    if (tab && !canDropTab(state, tab, destination)) {
      event.dataTransfer.dropEffect = "none";
      setOver(null);
      return false;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    return true;
  };

  const drop = async (event: DragEvent, destination: TabDestination) => {
    event.preventDefault();
    event.stopPropagation();
    const tab = source(event);
    clear();
    if (!(tab && canDropTab(state, tab, destination))) {
      return;
    }
    try {
      const result = await moveSidebarTab(invoke, tab, destination);
      if (result?.status === "confirmation-required") {
        setPendingMove({ tabId: tab.id, destination, reason: result.reason });
        setDragging(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This tab could not be moved. Try again.");
    }
  };

  const zone = (id: string, destination: TabDestination) => ({
    "data-drop-active": over?.id === id,
    onDragLeave: (event: DragEvent) => {
      event.stopPropagation();
      if (
        !(
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
      ) {
        setOver((current) => (current?.id === id ? null : current));
      }
    },
    onDragOver: (event: DragEvent) => {
      if (accept(event, destination)) {
        setOver({ id, position: "inside" });
      }
    },
    onDrop: (event: DragEvent) => drop(event, destination),
  });

  const row = (tab: Tab, siblings: Tab[], tile = false) => {
    const destination = {
      folderId: tab.folderId,
      kind: tab.kind,
      spaceId: tab.spaceId,
    };
    const positionAt = (event: DragEvent) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return (
        tile
          ? event.clientX < rect.left + rect.width / 2
          : event.clientY < rect.top + rect.height / 2
      )
        ? "before"
        : "after";
    };
    return {
      "data-dragging": draggingId === tab.id,
      "data-drop-position": over?.id === tab.id ? over.position : undefined,
      onDragEnd: (event: DragEvent) => {
        event.stopPropagation();
        clear();
      },
      onDragLeave: (event: DragEvent) => {
        event.stopPropagation();
        if (
          !(
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
        ) {
          setOver((current) => (current?.id === tab.id ? null : current));
        }
      },
      onDragOver: (event: DragEvent) => {
        if (sourceId.current === tab.id) {
          event.stopPropagation();
          return;
        }
        if (accept(event, destination)) {
          setOver({ id: tab.id, position: positionAt(event) });
        }
      },
      onDragStart: (event: DragEvent) => begin(event, tab),
      onDrop: (event: DragEvent) => {
        const moving = source(event);
        if (!moving || moving.id === tab.id) {
          event.preventDefault();
          event.stopPropagation();
          clear();
          return;
        }
        const remaining = siblings.filter(
          (candidate) => candidate.id !== moving.id
        );
        const index = remaining.findIndex(
          (candidate) => candidate.id === tab.id
        );
        const beforeId =
          positionAt(event) === "before"
            ? tab.id
            : (remaining[index + 1]?.id ?? null);
        drop(event, { ...destination, beforeId });
      },
    };
  };

  const cancelMove = () => { setPendingMove(null); setDragging(false); };
  const confirmMove = async () => {
    if (!pendingMove || moving) return;
    const tab = state.tabs.find((item) => item.id === pendingMove.tabId);
    if (!tab) { cancelMove(); return; }
    setMoving(true);
    try {
      await moveSidebarTab(invoke, tab, pendingMove.destination, { confirmReload: true });
      cancelMove();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The tab could not be moved.");
    } finally { setMoving(false); }
  };
  return { clear, draggingId, error, row, zone, pendingMove, moving, confirmMove, cancelMove };
}

export type SidebarDrag = ReturnType<typeof useSidebarDrag>;
