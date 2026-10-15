export interface TabContextMenuKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly nativeEvent: { readonly isComposing: boolean };
  preventDefault(): void;
  stopPropagation(): void;
}

export interface TabContextMenuAnchorTarget {
  getBoundingClientRect(): { readonly bottom: number };
}

export interface TabContextMenuPayload<TabId> {
  kind: "tab-menu";
  tabId: TabId;
  y: number;
}

export function openTabContextMenuFromKeyboard<TabId>(
  event: TabContextMenuKeyEvent,
  target: TabContextMenuAnchorTarget,
  tabId: TabId,
  open: (payload: TabContextMenuPayload<TabId>) => void,
): boolean {
  if (
    event.nativeEvent.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  ) {
    return false;
  }
  const isContextMenuKey = event.key === "ContextMenu" && !event.shiftKey;
  const isShiftF10 = event.key === "F10" && event.shiftKey;
  if (!isContextMenuKey && !isShiftF10) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  const rect = target.getBoundingClientRect();
  open({ kind: "tab-menu", tabId, y: rect.bottom });
  return true;
}
