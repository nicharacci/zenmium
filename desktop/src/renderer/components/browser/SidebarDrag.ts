import type { Invoke } from "@shared/browser-ui";
import { ARC_IPC, type ArcState, type Tab } from "@shared/ipc";
import type { DragEvent } from "react";
import { useRef, useState } from "react";

export const MAX_ESSENTIALS = 12;
const TAB_MIME = "application/x-zenmium-tab";
export interface TabDestination {
  beforeId?: string | null;
  folderId?: string | null;
  kind?: Tab["kind"];
  spaceId: string;
}

export const isEssentialTab = (tab: Tab) =>
  tab.kind === "pinned" && !tab.folderId;

/** Folder pins are ordinary rows; only the icon-only essential tiles use slots. */
export function canDropTab(
  state: ArcState,
  tab: Tab,
  destination: TabDestination
) {
  const kind = destination.kind ?? tab.kind;
  let { folderId } = destination;
  if (folderId === undefined) {
    folderId = destination.spaceId === tab.spaceId ? tab.folderId : null;
  }
  if (
    kind !== "pinned" ||
    folderId ||
    (isEssentialTab(tab) && tab.spaceId === destination.spaceId)
  ) {
    return true;
  }
  return (
    state.tabs.filter(
      (candidate) =>
        candidate.spaceId === destination.spaceId && isEssentialTab(candidate)
    ).length < MAX_ESSENTIALS
  );
}

/** Movement changes membership before ordering; folder moves implicitly pin in ArcCore. */
export async function moveSidebarTab(
  invoke: Invoke,
  tab: Tab,
  destination: TabDestination
) {
  const changingSpace = tab.spaceId !== destination.spaceId;
  let { kind } = tab;
  // Unpin before crossing workspaces when the destination is a folder or a
  // regular row. The intermediate root must not consume an essential slot.
  if (
    kind === "pinned" &&
    (destination.kind === "today" || (changingSpace && destination.folderId))
  ) {
    await invoke(ARC_IPC.unpinTab, tab.id);
    kind = "today";
  }
  if (changingSpace) {
    await invoke("arc:moveTabToSpace", {
      id: tab.id,
      spaceId: destination.spaceId,
    });
  }
  if (destination.folderId) {
    // moveToFolder pins directly, so it also works when essentials are full.
    await invoke(ARC_IPC.moveToFolder, {
      folderId: destination.folderId,
      id: tab.id,
    });
    if (changingSpace && tab.kind === "pinned" && tab.pinnedUrl) {
      // The temporary unpin above must not replace the original reset target.
      await invoke(ARC_IPC.updateTab, {
        id: tab.id,
        patch: {
          pinnedChanged: tab.pinnedUrl !== tab.url,
          pinnedUrl: tab.pinnedUrl,
        },
      });
    }
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
      await moveSidebarTab(invoke, tab, destination);
    } catch {
      setError("This tab could not be moved. Try again.");
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

  return { clear, draggingId, error, row, zone };
}

export type SidebarDrag = ReturnType<typeof useSidebarDrag>;
