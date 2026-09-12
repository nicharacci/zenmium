import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { z } from "zod";
import {
  type BrowserOverlayState,
  CHROME_IPC,
  preferencesSchema,
} from "../shared/browser-ui";
import { ARC_IPC, ARC_STATE_EVENT, rectSchema } from "../shared/ipc";
import { AGENT_IPC, AgentKernel } from "./agent-kernel";
import { ArcCore } from "./arc-core";
import { BrowserChrome } from "./browser-chrome";
import { BrowserDownloads } from "./browser-downloads";
import { EXTENSION_IPC, ExtensionHost } from "./extension-host";
import { hardenWindow, installSecurityPolicy } from "./security";
import { STORE_INSTALL_IPC, StoreInstaller } from "./store-install";

const events = new EventEmitter();
let win: BrowserWindow | null = null;
let arc: ArcCore | null = null;
let extensions: ExtensionHost | null = null;
let installer: StoreInstaller | null = null;
let agent: AgentKernel | null = null;
let chrome: BrowserChrome | null = null;
let downloads: BrowserDownloads | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    backgroundColor: "#111315",
    height: 900,
    minHeight: 560,
    minWidth: 800,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 16 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
    },
    width: 1440,
  });

  arc = new ArcCore(win, app.getPath("userData"));
  chrome = new BrowserChrome(win, arc, app.getPath("userData"));
  hardenWindow(win, (url) => arc?.newTab({ url }));

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  win.webContents.once("did-finish-load", () => arc?.boot());
  win.on("closed", () => {
    chrome?.dispose();
    chrome = null;
    arc?.dispose();
    arc = null;
    win = null;
  });
}

function wireIpc(): void {
  const core = () => {
    if (!arc) throw new Error("ArcCore not ready");
    return arc;
  };
  const handle: typeof ipcMain.handle = (channel, listener) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!chrome?.owns(event.sender))
        throw new Error(
          "Browser commands are available only to trusted browser chrome."
        );
      return listener(event, ...args);
    });

  handle(ARC_IPC.snapshot, () => core().snapshot());
  handle(ARC_IPC.createSpace, (_e, p) =>
    core().createSpace(
      String((p as { name: string }).name),
      (p as { color?: string }).color
    )
  );
  handle(ARC_IPC.activateSpace, (_e, p) => core().activateSpace(String(p)));
  handle(ARC_IPC.updateSpace, (_e, p) => {
    const { id, patch } = p as {
      id: string;
      patch: Parameters<ArcCore["updateSpace"]>[1];
    };
    core().updateSpace(id, patch);
  });
  handle(ARC_IPC.deleteSpace, (_e, p) => core().deleteSpace(String(p)));
  handle(ARC_IPC.newTab, (_e, p) =>
    core().newTab((p as { url?: string; spaceId?: string }) ?? {})
  );
  handle(ARC_IPC.closeTab, (_e, p) => core().closeTab(String(p)));
  handle(ARC_IPC.activateTab, (_e, p) => core().activateTab(String(p)));
  handle(ARC_IPC.updateTab, (_e, p) => {
    const { id, patch } = p as {
      id: string;
      patch: Parameters<ArcCore["updateTab"]>[1];
    };
    core().updateTab(id, patch);
  });
  handle(ARC_IPC.navigate, (_e, p) => {
    const { id, url } = p as { id: string; url: string };
    core().navigate(id, url);
  });
  handle(ARC_IPC.back, (_e, p) => core().back(String(p)));
  handle(ARC_IPC.forward, (_e, p) => core().forward(String(p)));
  handle(ARC_IPC.reload, (_e, p) => core().reload(String(p)));
  handle(ARC_IPC.pinTab, (_e, p) => core().pinTab(String(p)));
  handle(ARC_IPC.unpinTab, (_e, p) => core().unpinTab(String(p)));
  handle(ARC_IPC.createFolder, (_e, p) => {
    const { spaceId, name } = p as { spaceId: string; name: string };
    return core().createFolder(spaceId, name);
  });
  handle(ARC_IPC.renameFolder, (_e, p) => {
    const { id, name } = p as { id: string; name: string };
    core().renameFolder(id, name);
  });
  handle(ARC_IPC.deleteFolder, (_e, p) => core().deleteFolder(String(p)));
  handle(ARC_IPC.moveToFolder, (_e, p) => {
    const { id, folderId } = p as { id: string; folderId: string | null };
    core().moveToFolder(id, folderId);
  });
  handle(ARC_IPC.reorderTab, (_e, p) => {
    const { id, beforeId } = p as { id: string; beforeId: string | null };
    core().reorderTab(id, beforeId);
  });
  handle(ARC_IPC.archiveTab, (_e, p) => core().archiveTab(String(p)));
  handle(ARC_IPC.restoreTab, (_e, p) => core().restoreTab(String(p)));
  handle(ARC_IPC.clearArchive, () => core().clearArchive());
  handle(ARC_IPC.toggleSplit, (_e, p) => core().toggleSplit(String(p)));
  handle(ARC_IPC.openPeek, (_e, p) => core().openPeek(String(p)));
  handle(ARC_IPC.setContentBounds, (_e, p) =>
    core().setContentBounds(rectSchema.parse(p))
  );

  handle(ARC_IPC.stop, (_e, p) => core().stop(z.string().parse(p)));
  handle(ARC_IPC.resetTab, (_e, p) => core().resetTab(z.string().parse(p)));
  handle(ARC_IPC.updateFolder, (_e, p) => {
    const { id, patch } = z
      .object({
        id: z.string(),
        patch: z.object({
          collapsed: z.boolean().optional(),
          name: z.string().optional(),
        }),
      })
      .parse(p);
    core().updateFolder(id, patch);
  });
  handle(ARC_IPC.moveTabToSpace, (_e, p) => {
    const { id, spaceId } = z
      .object({ id: z.string(), spaceId: z.string() })
      .parse(p);
    core().moveTabToSpace(id, spaceId);
  });
  handle(ARC_IPC.clearHistory, () => core().clearHistory());
  handle(ARC_IPC.closePeek, () => core().closePeek());
  handle(ARC_IPC.promotePeek, () => core().promotePeek());
  handle(CHROME_IPC.snapshot, () => chrome?.snapshot());
  handle(CHROME_IPC.preferences, (_e, p) =>
    chrome?.updatePreferences(preferencesSchema.partial().parse(p))
  );
  handle(CHROME_IPC.migratePreferences, (_e, p) =>
    chrome?.migratePreferences(preferencesSchema.partial().parse(p))
  );
  handle(CHROME_IPC.sidebar, (_e, p) =>
    chrome?.updateSidebar(
      z
        .object({
          dragging: z.boolean().optional(),
          focused: z.boolean().optional(),
          hovered: z.boolean().optional(),
        })
        .parse(p)
    )
  );
  handle(CHROME_IPC.open, (_e, p) => {
    const overlay = z
      .object({
        kind: z.enum([
          "address",
          "new-tab",
          "menu",
          "tab-menu",
          "workspace",
          "workspace-edit",
          "history",
          "downloads",
          "extensions",
          "settings",
          "agent",
          "commands",
          "site-info",
        ]),
        spaceId: z.string().optional(),
        tabId: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      })
      .parse(p);
    chrome?.open(overlay as BrowserOverlayState);
  });
  handle(CHROME_IPC.close, (_e, p) =>
    chrome?.close(
      z.object({ sessionId: z.number().optional() }).optional().parse(p)
        ?.sessionId
    )
  );
  handle(CHROME_IPC.command, (_e, p) => chrome?.command(z.string().parse(p)));
  handle(CHROME_IPC.downloads, () => downloads?.list() ?? []);
  handle(CHROME_IPC.downloadAction, (_e, p) => {
    const { id, action } = z
      .object({
        action: z.enum(["pause", "resume", "cancel", "show", "open"]),
        id: z.string(),
      })
      .parse(p);
    return downloads?.action(id, action);
  });
  handle(CHROME_IPC.windowAction, (_e, p) => {
    if (p === "minimize") win?.minimize();
    else if (p === "maximize" && win)
      win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (p === "close") win?.close();
  });
  handle(CHROME_IPC.extensionLoad, async () => {
    if (!win || !extensions) return;
    const chosen = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Load unpacked extension",
    });
    const path = chosen.filePaths[0];
    if (chosen.canceled || !path) return;
    const manifest = JSON.parse(
      await readFile(join(path, "manifest.json"), "utf8")
    ) as { name?: string; version?: string };
    return extensions.load({
      enabled: true,
      id: path,
      name: manifest.name ?? "Extension",
      path,
      version: manifest.version ?? "0",
    });
  });

  handle(EXTENSION_IPC.list, () => extensions?.list());
  handle(EXTENSION_IPC.setEnabled, (_e, p) => {
    const { id: extId, enabled } = p as { id: string; enabled: boolean };
    return extensions?.setEnabled(extId, enabled);
  });
  handle(EXTENSION_IPC.remove, (_e, p) =>
    extensions?.remove((p as { id: string }).id)
  );
  handle(STORE_INSTALL_IPC.start, (_e, p) => installer?.start(String(p)));

  handle(AGENT_IPC.newSession, () => agent?.newSession());
  handle(AGENT_IPC.prompt, (_e, p) => {
    const { sessionId, text } = p as { sessionId: string; text: string };
    return agent?.prompt(sessionId, text);
  });
  handle(AGENT_IPC.abort, (_e, p) =>
    agent?.abort((p as { sessionId: string }).sessionId)
  );
}

app.whenReady().then(async () => {
  installSecurityPolicy();
  extensions = new ExtensionHost({ events });
  installer = new StoreInstaller({ events, host: extensions });
  agent = new AgentKernel({ events });
  wireIpc();
  createWindow();
  downloads = new BrowserDownloads(app.getPath("userData"), () => {
    if (chrome) chrome.broadcast(CHROME_IPC.event, chrome.snapshot());
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "Zenmium", role: "appMenu" },
      {
        label: "File",
        submenu: [
          {
            accelerator: "CmdOrCtrl+T",
            click: () => chrome?.command("new-tab"),
            label: "New Tab",
          },
          {
            accelerator: "CmdOrCtrl+Shift+T",
            click: () => chrome?.command("reopen"),
            label: "Reopen Closed Tab",
          },
          {
            accelerator: "CmdOrCtrl+W",
            click: () => chrome?.command("close-tab"),
            label: "Close Tab",
          },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          {
            accelerator: "CmdOrCtrl+S",
            click: () => chrome?.command("compact"),
            label: "Compact Mode",
          },
          { role: "togglefullscreen" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "toggleDevTools" },
        ],
      },
      {
        label: "History",
        submenu: [
          { click: () => chrome?.command("history"), label: "Show History" },
          { click: () => chrome?.command("back"), label: "Back" },
          { click: () => chrome?.command("forward"), label: "Forward" },
        ],
      },
      { role: "windowMenu" },
    ])
  );

  events.on(EXTENSION_IPC.progress, (payload) =>
    chrome?.broadcast(EXTENSION_IPC.progress, payload)
  );
  events.on(STORE_INSTALL_IPC.progress, (payload) =>
    chrome?.broadcast(STORE_INSTALL_IPC.progress, payload)
  );
  agent.onEvent((event) => chrome?.broadcast(AGENT_IPC.event, event));

  await extensions.boot();
  void agent.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void agent?.stop();
  arc?.dispose();
  extensions?.dispose();
  downloads?.dispose();
});
