import { join } from "node:path";
import { EventEmitter } from "node:events";
import { app, BrowserWindow, ipcMain } from "electron";
import { ArcCore } from "./arc-core";
import { hardenWindow, installSecurityPolicy } from "./security";
import { ExtensionHost, EXTENSION_IPC } from "./extension-host";
import { StoreInstaller, STORE_INSTALL_IPC } from "./store-install";
import { AgentKernel, AGENT_IPC } from "./agent-kernel";
import { ARC_IPC, ARC_STATE_EVENT, rectSchema } from "../shared/ipc";

const events = new EventEmitter();
let win: BrowserWindow | null = null;
let arc: ArcCore | null = null;
let extensions: ExtensionHost | null = null;
let installer: StoreInstaller | null = null;
let agent: AgentKernel | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 16 },
    backgroundColor: "#101214",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  arc = new ArcCore(win, app.getPath("userData"));
  hardenWindow(win, (url) => arc?.newTab({ url }));
  arc.onState((state) => win?.webContents.send(ARC_STATE_EVENT, state));

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  win.webContents.once("did-finish-load", () => arc?.boot());
}

function wireIpc(): void {
  const core = () => {
    if (!arc) throw new Error("ArcCore not ready");
    return arc;
  };

  ipcMain.handle(ARC_IPC.snapshot, () => core().snapshot());
  ipcMain.handle(ARC_IPC.createSpace, (_e, p) => core().createSpace(String((p as { name: string }).name), (p as { color?: string }).color));
  ipcMain.handle(ARC_IPC.activateSpace, (_e, p) => core().activateSpace(String(p)));
  ipcMain.handle(ARC_IPC.updateSpace, (_e, p) => {
    const { id, patch } = p as { id: string; patch: Record<string, string> };
    core().updateSpace(id, patch);
  });
  ipcMain.handle(ARC_IPC.deleteSpace, (_e, p) => core().deleteSpace(String(p)));
  ipcMain.handle(ARC_IPC.newTab, (_e, p) => core().newTab((p as { url?: string; spaceId?: string }) ?? {}));
  ipcMain.handle(ARC_IPC.closeTab, (_e, p) => core().closeTab(String(p)));
  ipcMain.handle(ARC_IPC.activateTab, (_e, p) => core().activateTab(String(p)));
  ipcMain.handle(ARC_IPC.navigate, (_e, p) => {
    const { id, url } = p as { id: string; url: string };
    core().navigate(id, url);
  });
  ipcMain.handle(ARC_IPC.back, (_e, p) => core().back(String(p)));
  ipcMain.handle(ARC_IPC.forward, (_e, p) => core().forward(String(p)));
  ipcMain.handle(ARC_IPC.reload, (_e, p) => core().reload(String(p)));
  ipcMain.handle(ARC_IPC.pinTab, (_e, p) => core().pinTab(String(p)));
  ipcMain.handle(ARC_IPC.unpinTab, (_e, p) => core().unpinTab(String(p)));
  ipcMain.handle(ARC_IPC.createFolder, (_e, p) => {
    const { spaceId, name } = p as { spaceId: string; name: string };
    return core().createFolder(spaceId, name);
  });
  ipcMain.handle(ARC_IPC.renameFolder, (_e, p) => {
    const { id, name } = p as { id: string; name: string };
    core().renameFolder(id, name);
  });
  ipcMain.handle(ARC_IPC.deleteFolder, (_e, p) => core().deleteFolder(String(p)));
  ipcMain.handle(ARC_IPC.moveToFolder, (_e, p) => {
    const { id, folderId } = p as { id: string; folderId: string | null };
    core().moveToFolder(id, folderId);
  });
  ipcMain.handle(ARC_IPC.reorderTab, (_e, p) => {
    const { id, beforeId } = p as { id: string; beforeId: string | null };
    core().reorderTab(id, beforeId);
  });
  ipcMain.handle(ARC_IPC.archiveTab, (_e, p) => core().archiveTab(String(p)));
  ipcMain.handle(ARC_IPC.restoreTab, (_e, p) => core().restoreTab(String(p)));
  ipcMain.handle(ARC_IPC.clearArchive, () => core().clearArchive());
  ipcMain.handle(ARC_IPC.toggleSplit, (_e, p) => core().toggleSplit(String(p)));
  ipcMain.handle(ARC_IPC.openPeek, (_e, p) => core().openPeek(String(p)));
  ipcMain.handle(ARC_IPC.setContentBounds, (_e, p) => core().setContentBounds(rectSchema.parse(p)));

  ipcMain.handle(EXTENSION_IPC.list, () => extensions?.list());
  ipcMain.handle(EXTENSION_IPC.setEnabled, (_e, p) => {
    const { id: extId, enabled } = p as { id: string; enabled: boolean };
    return extensions?.setEnabled(extId, enabled);
  });
  ipcMain.handle(EXTENSION_IPC.remove, (_e, p) => extensions?.remove((p as { id: string }).id));
  ipcMain.handle(STORE_INSTALL_IPC.start, (_e, p) => installer?.start(String(p)));

  ipcMain.handle(AGENT_IPC.newSession, () => agent?.newSession());
  ipcMain.handle(AGENT_IPC.prompt, (_e, p) => {
    const { sessionId, text } = p as { sessionId: string; text: string };
    return agent?.prompt(sessionId, text);
  });
  ipcMain.handle(AGENT_IPC.abort, (_e, p) => agent?.abort((p as { sessionId: string }).sessionId));
}

app.whenReady().then(async () => {
  installSecurityPolicy();
  extensions = new ExtensionHost({ events });
  installer = new StoreInstaller({ host: extensions, events });
  agent = new AgentKernel({ events });
  wireIpc();
  createWindow();

  events.on(EXTENSION_IPC.progress, (payload) => win?.webContents.send(EXTENSION_IPC.progress, payload));
  events.on(STORE_INSTALL_IPC.progress, (payload) => win?.webContents.send(STORE_INSTALL_IPC.progress, payload));
  agent.onEvent((event) => win?.webContents.send(AGENT_IPC.event, event));

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
});
