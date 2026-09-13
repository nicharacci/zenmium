import {
  CHROME_IPC,
  type BrowserNotification,
} from "@shared/browser-ui";
import type { ArcState } from "@shared/ipc";
import { Toaster, toast } from "sonner";
import { useEffect, useRef } from "react";

import "sonner/dist/styles.css";

type NotificationProps = {
  dark: boolean;
  state: ArcState;
};

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return clean ? clean.slice(0, limit) : undefined;
}

function parseNotification(value: unknown): BrowserNotification | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const title = text(input.title, 120);
  const kind = input.kind;
  if (
    !title ||
    (kind !== "info" &&
      kind !== "success" &&
      kind !== "warning" &&
      kind !== "error")
  ) {
    return null;
  }
  const duration =
    typeof input.duration === "number" && Number.isFinite(input.duration)
      ? Math.max(1800, Math.min(12_000, Math.round(input.duration)))
      : undefined;
  return {
    description: text(input.description, 300),
    duration,
    id: text(input.id, 180),
    kind,
    title,
  };
}

function showNotification(notification: BrowserNotification): void {
  const options = {
    className: "zen-sonner-toast",
    description: notification.description,
    duration: notification.duration,
    id: notification.id,
  };
  if (notification.kind === "success") toast.success(notification.title, options);
  else if (notification.kind === "warning") toast.warning(notification.title, options);
  else if (notification.kind === "error") toast.error(notification.title, options);
  else toast.info(notification.title, options);
}

export function ZenNotifications({ dark, state }: NotificationProps) {
  const lastTabError = useRef<string | null>(null);

  useEffect(() => {
    const offNotification = window.zenmium.on(
      CHROME_IPC.notification,
      (value) => {
        const notification = parseNotification(value);
        if (notification) showNotification(notification);
      },
    );
    const offCommand = window.zenmium.on(CHROME_IPC.commandEvent, (value) => {
      if (!value || typeof value !== "object") return;
      const error = text((value as Record<string, unknown>).error, 300);
      if (error) {
        showNotification({
          description: error,
          kind: "error",
          title: "Browser action failed",
        });
      }
    });
    return () => {
      offNotification();
      offCommand();
    };
  }, []);

  useEffect(() => {
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    const error = text(active?.error, 300);
    const key = error && active ? `${active.id}:${error}` : null;
    if (key && key !== lastTabError.current) {
      showNotification({
        description: error,
        id: `tab-error:${active?.id ?? "active"}`,
        kind: "error",
        title: "Unable to open this page",
      });
    }
    lastTabError.current = key;
  }, [state.activeTabId, state.tabs]);

  return (
    <Toaster
      closeButton
      expand={false}
      position="bottom-center"
      richColors={false}
      theme={dark ? "dark" : "light"}
      toastOptions={{
        className: "zen-sonner-toast",
        duration: 4_500,
      }}
      visibleToasts={4}
    />
  );
}
