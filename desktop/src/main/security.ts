import { BrowserWindow, session, shell } from "electron";

/** Deny-by-default permission handler for the default session. Web pages get media and clipboard only over https. */
export function installSecurityPolicy(): void {
  const allowed = new Set(["clipboard-read", "clipboard-sanitized-write", "media", "fullscreen", "pointerLock"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const url = details?.requestingUrl ?? "";
    callback(url.startsWith("https://") && allowed.has(permission));
  });
}

/**
 * Window-level hardening. The chrome renderer keeps context isolation and no Node access.
 * New windows never spawn here; https targets become product tabs, everything else goes to the OS.
 */
export function hardenWindow(win: BrowserWindow, onNewTab: (url: string) => void): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      onNewTab(url);
    } else {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL() && /^https?:/.test(url)) {
      event.preventDefault();
      onNewTab(url);
    }
  });
}
