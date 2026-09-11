import { join } from "node:path";
import { EventEmitter } from "node:events";
import { app, BrowserWindow, ipcMain } from "electron";
import { ElectronBrowserCore, type BrowserCore } from "./browser-core";
import { hardenWindow, installSecurityPolicy } from "./security";
import { ExtensionHost, EXTENSION_IPC } from "./extension-host";
import { StoreInstaller, STORE_INSTALL_IPC } from "./store-install";
import { AgentKernel, AGENT_IPC } from "./agent-kernel";
import {
  BROWSER_EVENT_CHANNEL,
  BROWSER_IPC,
  navigatePayloadSchema,
  rectSchema,
  tabIdPayloadSchema,
} from "../shared/ipc";

const events = new EventEmitter();
let win: BrowserWindow | null = null;
let core: BrowserCore | null = null;
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
    backgroundColor: "#101214",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload requires sandbox off in electron-vite; the renderer still has no Node access.
      sandbox: false,
    },
  });

  core = new ElectronBrowserCore(win);
  hardenWindow(win, (url) => core?.createTab(url));
  core.onEvent((event) => win?.webContents.send(BROWSER_EVENT_CHANNEL, event));
  core.createTab();

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

function wireIpc(): void {
  ipcMain.handle(BROWSER_IPC.createTab, (_e, payload: unknown) => {
    const url = (payload as { url?: string } | undefined)?.url;
    return core?.createTab(url);
  });
  ipcMain.handle(BROWSER_IPC.closeTab, (_e, payload) => {
    core?.closeTab(tabIdPayloadSchema.parse(payload).id);
  });
  ipcMain.handle(BROWSER_IPC.activateTab, (_e, payload) => {
    core?.activateTab(tabIdPayloadSchema.parse(payload).id);
  });
  ipcMain.handle(BROWSER_IPC.navigate, (_e, payload) => {
    const parsed = navigatePayloadSchema.parse(payload);
    core?.navigate(parsed.id, parsed.url);
  });
  ipcMain.handle(BROWSER_IPC.back, (_e, payload) => {
    core?.back(tabIdPayloadSchema.parse(payload).id);
  });
  ipcMain.handle(BROWSER_IPC.forward, (_e, payload) => {
    core?.forward(tabIdPayloadSchema.parse(payload).id);
  });
  ipcMain.handle(BROWSER_IPC.reload, (_e, payload) => {
    core?.reload(tabIdPayloadSchema.parse(payload).id);
  });
  ipcMain.handle(BROWSER_IPC.setContentBounds, (_e, payload) => {
    core?.setContentBounds(rectSchema.parse(payload));
  });
  ipcMain.handle(BROWSER_IPC.list, () => core?.list());

  ipcMain.handle(EXTENSION_IPC.list, () => extensions?.list());
  ipcMain.handle(EXTENSION_IPC.setEnabled, (_e, payload) => {
    const { id, enabled } = payload as { id: string; enabled: boolean };
    return extensions?.setEnabled(id, enabled);
  });
  ipcMain.handle(EXTENSION_IPC.remove, (_e, payload) => {
    return extensions?.remove((payload as { id: string }).id);
  });
  ipcMain.handle(STORE_INSTALL_IPC.start, (_e, payload) => installer?.start(String(payload)));

  ipcMain.handle(AGENT_IPC.newSession, () => agent?.newSession());
  ipcMain.handle(AGENT_IPC.prompt, (_e, payload) => {
    const { sessionId, text } = payload as { sessionId: string; text: string };
    return agent?.prompt(sessionId, text);
  });
  ipcMain.handle(AGENT_IPC.abort, (_e, payload) => {
    return agent?.abort((payload as { sessionId: string }).sessionId);
  });
}

app.whenReady().then(async () => {
  installSecurityPolicy();
  extensions = new ExtensionHost({ events });
  installer = new StoreInstaller({ host: extensions, events });
  agent = new AgentKernel({ events });
  wireIpc();
  createWindow();

  events.on(EXTENSION_IPC.progress, (payload) => win?.webContents.send(EXTENSION_IPC.progress, payload));
  events.on(STORE_INSTALL_IPC.progress, (payload) =>
    win?.webContents.send(STORE_INSTALL_IPC.progress, payload),
  );
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
  extensions?.dispose();
});
