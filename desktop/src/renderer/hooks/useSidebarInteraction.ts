import {
  CHROME_IPC,
  type Invoke,
  type SidebarInteraction,
} from "@shared/browser-ui";
import type { FocusEvent } from "react";
import { useCallback, useEffect, useRef } from "react";

const EXIT_DELAY = 150;

/** A native sidebar view receives mouse events across its entire transparent viewport. */
export function useSidebarInteraction(
  invoke: Invoke,
  shared: SidebarInteraction
) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interaction = useRef<SidebarInteraction>({
    dragging: false,
    focused: false,
    hovered: false,
  });
  const keyboardFocus = useRef(false);
  const pointerInside = useRef(false);

  useEffect(() => {
    interaction.current = { ...shared };
  }, [shared.hovered, shared.focused, shared.dragging]);

  const cancelExit = useCallback(() => {
    if (exitTimer.current !== null) {
      clearTimeout(exitTimer.current);
    }
    exitTimer.current = null;
  }, []);

  const patch = useCallback(
    (next: Partial<SidebarInteraction>) => {
      const changed = Object.entries(next).some(
        ([key, value]) =>
          interaction.current[key as keyof SidebarInteraction] !== value
      );
      if (!changed) {
        return;
      }
      interaction.current = { ...interaction.current, ...next };
      invoke(CHROME_IPC.sidebar, next);
    },
    [invoke]
  );

  const enter = useCallback(() => {
    pointerInside.current = true;
    cancelExit();
    patch({ hovered: true });
  }, [cancelExit, patch]);

  const leave = useCallback(() => {
    pointerInside.current = false;
    cancelExit();
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      const active = document.activeElement;
      // A clicked button retains DOM focus after the pointer exits. Only live
      // keyboard focus or an editor may keep the native view expanded.
      const holdsFocus =
        document.hasFocus() &&
        !!active &&
        !!surfaceRef.current?.contains(active) &&
        (keyboardFocus.current ||
          active.matches("input, textarea, [contenteditable=true]"));
      if (
        !holdsFocus &&
        active instanceof HTMLElement &&
        surfaceRef.current?.contains(active)
      ) {
        active.blur();
      }
      patch({ focused: holdsFocus, hovered: false });
    }, EXIT_DELAY);
  }, [cancelExit, patch]);

  const setDragging = useCallback(
    (dragging: boolean) => {
      patch({ dragging });
      if (!(dragging || pointerInside.current)) {
        leave();
      }
    },
    [leave, patch]
  );

  const onFocusCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (
        keyboardFocus.current ||
        event.target.matches("input, textarea, [contenteditable=true]")
      ) {
        patch({ focused: true });
      }
    },
    [patch]
  );

  const onBlurCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (
        !(
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
      ) {
        patch({ focused: false });
      }
    },
    [patch]
  );

  useEffect(() => {
    const root = document.documentElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        keyboardFocus.current = true;
      }
      if (event.key === "Escape") {
        const active = document.activeElement;
        // Let inline editors cancel before any blur could commit their value.
        if (active?.matches("input, textarea, [contenteditable=true]")) {
          return;
        }
        if (
          active instanceof HTMLElement &&
          surfaceRef.current?.contains(active)
        ) {
          active.blur();
        }
        keyboardFocus.current = false;
        patch({ focused: false });
      }
    };
    const onPointerDown = () => {
      keyboardFocus.current = false;
      patch({ focused: false });
    };
    const onWindowBlur = () => {
      cancelExit();
      pointerInside.current = false;
      keyboardFocus.current = false;
      patch({ dragging: false, focused: false, hovered: false });
    };
    const onDragEnd = () => setDragging(false);
    const offCommands = window.zenmium.on(
      CHROME_IPC.commandEvent,
      (command) => {
        if (command !== "focus-sidebar") return;
        keyboardFocus.current = true;
        requestAnimationFrame(() =>
          surfaceRef.current
            ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
            ?.focus()
        );
      }
    );
    root.addEventListener("mouseenter", enter);
    root.addEventListener("mouseleave", leave);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", onDragEnd);
    return () => {
      offCommands();
      cancelExit();
      root.removeEventListener("mouseenter", enter);
      root.removeEventListener("mouseleave", leave);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("drop", onDragEnd);
      invoke(CHROME_IPC.sidebar, {
        dragging: false,
        focused: false,
        hovered: false,
      });
    };
  }, [cancelExit, enter, invoke, leave, patch, setDragging]);

  return {
    enter,
    leave,
    onBlurCapture,
    onFocusCapture,
    setDragging,
    surfaceRef,
  };
}
