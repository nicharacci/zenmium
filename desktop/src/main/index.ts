import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  screen,
  shell,
  WebContentsView,
} from "electron";
import { z } from "zod";
import { CHAT_IPC, CHAT_LIMITS } from "../shared/agent-chat";
import {
  CONTROL_IPC,
  controlGrantSchema,
  controlSessionInputSchema,
} from "../shared/browser-control";
import {
  bookmarkCommandSchema,
  NATIVE_IPC,
  utilityCommandSchema,
} from "../shared/browser-native";
import {
  type BrowserNotification,
  type BrowserOverlayState,
  CHROME_IPC,
  preferencesSchema,
} from "../shared/browser-ui";
import { ARC_IPC, rectSchema } from "../shared/ipc";
import { AgentChatManager } from "./agent-chat-manager";
import { AGENT_IPC, AgentKernel } from "./agent-kernel";
import { ArcCore } from "./arc-core";
import { AuthenticationBroker } from "./authentication-broker";
import { BrowserBlocking } from "./browser-blocking";
import { BrowserChrome } from "./browser-chrome";
import { BrowserControlService } from "./browser-control";
import { startBrowserControlBridge } from "./browser-control-bridge";
import { NativeBrowserControlDriver } from "./browser-control-native";
import { BrowserDownloads } from "./browser-downloads";
import { NativeBrowserServices } from "./browser-native";
import { webUrl } from "./browser-url";
import {
  ChromeCredentialStore,
  importChromeCredentials,
} from "./chrome-credentials";
import {
  type ChromeProfileDescriptor,
  copyChromeExtension,
  listChromeExtensionSources,
} from "./chrome-profile-import";
import {
  bridgeScript,
  bridgeUrl,
  interpretBridgeResult,
} from "./extension-action-bridge";
import {
  EXTENSION_IPC,
  type ExtensionAction,
  ExtensionHost,
} from "./extension-host";
import {
  BrowserPermissions,
  hardenWindow,
  installSecurityPolicy,
} from "./security";
import { STORE_INSTALL_IPC, StoreInstaller } from "./store-install";
import {
  cancelVerificationMessageBox,
  createVerificationGuard,
  prepareVerificationStartup,
  verificationRequested,
} from "./verification-startup";
import type { WorkspaceSession } from "./workspace-sessions";

app.setName("Zenmium");
let verification = false;
let primaryInstance = false;
try {
  verification = verificationRequested(process.env.ZENMIUM_VERIFY_SIDE_MONITOR);
  primaryInstance = prepareVerificationStartup(verification, {
    createTemporaryDirectory: (parent) =>
      mkdtempSync(join(parent ?? tmpdir(), "zenmium-verification-")),
    lock: () => app.requestSingleInstanceLock(),
    setPath: (name, path) => app.setPath(name, path),
    useAccessoryActivation: () => {
      if (process.platform === "darwin") {
        app.setActivationPolicy("accessory");
      }
    },
  });
} catch {
  app.quit();
}
if (!primaryInstance) {
  app.quit();
}
const verificationGuard = verification
  ? createVerificationGuard({
      displays: () => ({
        displays: screen.getAllDisplays(),
        primaryId: screen.getPrimaryDisplay().id,
      }),
      quit: () => app.quit(),
      windows: () => BrowserWindow.getAllWindows(),
    })
  : null;
let creatingVerificationWindow = false;
if (verificationGuard) {
  // Verification-only scoped monkeypatch: ArcCore and security import the shared
  // Electron shell directly. Reject before any OS handoff; never delegate.
  shell.openExternal = () => {
    throw new Error(
      "External applications are unavailable during verification."
    );
  };
  // ArcCore's view constructors are outside this verification seam. Electron
  // 42.11.3 routes page alert/confirm through the shared dialog.showMessageBox
  // property (lib/browser/api/web-contents.ts). Cancel before native invocation,
  // including parentless views, rather than relying on a nonexistent before-modal
  // event or altering private listeners. This scoped monkeypatch is version-coupled;
  // prefer disableDialogs in every view constructor when that scope is available.
  dialog.showMessageBox = cancelVerificationMessageBox;
  app.on("activate", () => verificationGuard.stop());
  app.on("web-contents-created", (_event, contents) => {
    contents.focus = () => undefined;
  });
  app.on("browser-window-created", (_event, window) => {
    if (!verificationGuard.windowCreated(window, creatingVerificationWindow)) {
      let destroyed = false;
      try {
        destroyed = window.isDestroyed();
      } catch {
        /* Still attempt destruction. */
      }
      if (!destroyed) {
        try {
          window.destroy();
        } catch {
          /* Shutdown was already requested by the guard. */
        }
      }
      return;
    }
    window.show = () => verificationGuard.stop();
    window.focus = () => verificationGuard.stop();
    window.restore = () => verificationGuard.stop();
    window.setFocusable(false);
    window.on("move", () => verificationGuard.validateWindow(window));
    window.on("resize", () => verificationGuard.validateWindow(window));
    window.on("focus", () => verificationGuard.stop());
    window.on("closed", () => verificationGuard.stop());
  });
}

const events = new EventEmitter();
let win: BrowserWindow | null = null;
let arc: ArcCore | null = null;
let agent: AgentKernel | null = null;
let chrome: BrowserChrome | null = null;
let downloads: BrowserDownloads | null = null;
let permissions: BrowserPermissions | null = null;
let blocking: BrowserBlocking | null = null;
let native: NativeBrowserServices | null = null;
let control: BrowserControlService | null = null;
let authentication: AuthenticationBroker | null = null;
let chat: AgentChatManager | null = null;
let controlBridge: Awaited<
  ReturnType<typeof startBrowserControlBridge>
> | null = null;
let bridgeStarting: Promise<
  Awaited<ReturnType<typeof startBrowserControlBridge>>
> | null = null;
let chromeCredentialStore: ChromeCredentialStore | null = null;
const profileHosts = new Map<
  string,
  { host: ExtensionHost; installer: StoreInstaller }
>();
const CHROMIUM_WEB_STORE_ID = "ocaahdebbfolfmndjeplogmgcagdmblk";
const chatGrants = new Map<
  string,
  { grantId: string; token: string; sessionId: string }
>();
const pendingOpen: Array<{ url?: string; path?: string }> = [];
let readyForLinks = false;
let popup: WebContentsView | null = null;
let unsubscribeProfiles: (() => void) | undefined;
let ipcWired = false;
let activateWired = false;

function requireNativeDialogs(): void {
  if (verification) {
    throw new Error("Native dialogs are unavailable during verification.");
  }
}

function browserNotification(notification: BrowserNotification): void {
  chrome?.broadcast(CHROME_IPC.notification, notification);
}

function bundledChromiumWebStorePath(): string | null {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const candidate = join(
    root,
    app.isPackaged ? "chromium-web-store" : "resources/chromium-web-store",
    "Chromium Web Store.crx"
  );
  return existsSync(candidate) ? candidate : null;
}

function activeProfileServices(): {
  host: ExtensionHost;
  installer: StoreInstaller;
} | null {
  if (!arc) {
    return null;
  }
  const state = arc.snapshot();
  const profileId = arc.getProfileId(state.activeSpaceId);
  const current = profileHosts.get(profileId);
  if (current) {
    return current;
  }
  // The active tab may still be about:blank. Resolving its persistent Session is
  // also what creates the profile-bound extension host and security hooks.
  try {
    arc.getSessionForSpace(state.activeSpaceId);
  } catch {
    return null;
  }
  return profileHosts.get(profileId) ?? null;
}

async function importChromeExtensionsForSpace(
  spaceId: string,
  profile: ChromeProfileDescriptor
) {
  if (!arc) {
    throw new Error("Browser is not ready.");
  }
  // Creating the session synchronously also wires the profile-bound ExtensionHost before
  // the first imported extension is loaded.
  const profileId = arc.getProfileId(spaceId);
  arc.getSessionForSpace(spaceId);
  const services = profileHosts.get(profileId);
  if (!services) {
    return {
      imported: 0,
      notes: [
        "The Workspace profile could not be initialized for extension import.",
      ],
      onePasswordDetected: false,
      skipped: profile.extensionCount,
    };
  }
  const sources = await listChromeExtensionSources(profile);
  const targetRoot = join(
    app.getPath("userData"),
    "zenmium",
    "profiles",
    profileId,
    "extensions",
    "chrome-imports"
  );
  let imported = 0;
  let skipped = 0;
  let onePasswordDetected = false;
  const notes: string[] = [];
  for (const source of sources) {
    onePasswordDetected ||= /1password/i.test(source.name);
    try {
      const copied = await copyChromeExtension(source, targetRoot);
      const result = await services.host.load({
        enabled: true,
        id: source.id,
        name: source.name,
        path: copied.copiedPath,
        source: "unpacked",
        version: source.version,
      });
      if (result.ok) {
        imported += 1;
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  if (sources.length < profile.extensionCount) {
    skipped += profile.extensionCount - sources.length;
  }
  if (skipped) {
    notes.push(
      `${skipped} Chrome extension${skipped === 1 ? "" : "s"} could not be loaded by this Electron build.`
    );
  }
  return { imported, notes, onePasswordDetected, skipped };
}

async function importChromeCredentialsForSpace(
  spaceId: string,
  profile: ChromeProfileDescriptor
) {
  if (!(arc && chromeCredentialStore)) {
    throw new Error("Credential migration is not ready.");
  }
  return importChromeCredentials(
    profile,
    arc.getSessionForSpace(spaceId),
    arc.getProfileId(spaceId),
    chromeCredentialStore
  );
}

/** Hidden bridge dispatch: never shown, never focused, no monitor placement. */
async function dispatchExtensionAction(
  extensionId: string,
  targetSession: Electron.Session,
  tabId?: number
): Promise<void> {
  if (verificationGuard) {
    throw new Error("Extension dispatch is unavailable during verification.");
  }
  const url = bridgeUrl(extensionId);
  const hidden = new BrowserWindow({
    height: 10,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: targetSession,
    },
    width: 10,
  });
  try {
    await hidden.loadURL(url);
    const raw = await hidden.webContents.executeJavaScript(
      bridgeScript(tabId),
      true
    );
    const result = interpretBridgeResult(raw);
    if (!result.ok) {
      throw new Error(result.reason);
    }
  } finally {
    if (!hidden.isDestroyed()) {
      hidden.close();
    }
  }
}

async function attachWorkspaceSession(entry: WorkspaceSession): Promise<void> {
  if (!(permissions && blocking && downloads)) {
    return;
  }
  const existing = profileHosts.get(entry.profileId);
  if (!existing) {
    const profileDirectory = join(
      app.getPath("userData"),
      "zenmium",
      "profiles",
      entry.profileId
    );
    const host = new ExtensionHost({
      dispatchAction: (extensionId, _session, tabId) =>
        dispatchExtensionAction(extensionId, entry.session, tabId),
      events,
      openPopup: (action) => openExtensionPopup(action, entry.session),
      profileId: entry.profileId,
      registryPath: join(profileDirectory, "extensions.json"),
      session: entry.session,
    });
    profileHosts.set(entry.profileId, {
      host,
      installer: new StoreInstaller({
        events,
        extensionsRoot: join(profileDirectory, "extensions"),
        host,
      }),
    });
  }
  // Permission checks must be installed synchronously before any page load.
  permissions.attach(entry.profileId, entry.session);
  downloads.attach(entry.profileId, entry.spaceId, entry.session);
  // Filter-list hydration is deliberately not on the first-page critical path.
  void blocking.attach(entry.profileId, entry.session).catch(() => undefined);
  const result = await profileHosts.get(entry.profileId)!.host.boot();
  if (!result.ok) {
    events.emit(EXTENSION_IPC.progress, {
      id: "profile",
      name: "Workspace extensions",
      profileId: entry.profileId,
      reason: result.reason,
      status: "error",
    });
  }
  const services = profileHosts.get(entry.profileId);
  const helperPath = bundledChromiumWebStorePath();
  if (
    result.ok &&
    services &&
    helperPath &&
    !services.host.get(CHROMIUM_WEB_STORE_ID)
  ) {
    const helper = await services.installer.installLocal(
      helperPath,
      CHROMIUM_WEB_STORE_ID
    );
    if (!helper.ok) {
      events.emit(EXTENSION_IPC.progress, {
        id: CHROMIUM_WEB_STORE_ID,
        name: "Chromium Web Store",
        profileId: entry.profileId,
        reason: helper.reason,
        status: "error",
      });
    }
  }
}

function attachmentMime(path: string): string {
  const extension = extname(path).toLowerCase();
  return (
    (
      {
        ".csv": "text/csv",
        ".gif": "image/gif",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".json": "application/json",
        ".md": "text/markdown",
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".txt": "text/plain",
        ".webp": "image/webp",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
}

async function bridge(): Promise<NonNullable<typeof controlBridge>> {
  if (!(control && native?.isAgentEnabled())) {
    throw new Error(
      "Enable the optional agent before connecting a browser client."
    );
  }
  if (controlBridge) {
    return controlBridge;
  }
  bridgeStarting ??= startBrowserControlBridge(control);
  controlBridge = await bridgeStarting;
  return controlBridge;
}
function humanTab(tabId: string | null | undefined): void {
  if (tabId) {
    control?.takeoverTab(tabId);
  }
}
function closeExtensionPopup(): void {
  const view = popup;
  popup = null;
  win?.removeListener("resize", extensionPopupResizeHandler);
  if (view && !view.webContents.isDestroyed()) {
    if (win && !win.isDestroyed()) {
      win.contentView.removeChildView(view);
    }
    view.webContents.close();
  }
}

function sizeExtensionPopup(): void {
  const view = popup;
  if (!(win && view && !win.isDestroyed())) {
    return;
  }
  const bounds = win.getContentBounds();
  const height = 480;
  const width = 360;
  view.setBounds({
    height,
    width,
    x: bounds.width - width,
    y: bounds.height - height,
  });
}

function extensionPopupResizeHandler(): void {
  sizeExtensionPopup();
}

/** Mounts the declared extension popup in the profile's own Session. */
function openExtensionPopup(
  action: ExtensionAction,
  session: Electron.Session
): Promise<void> {
  if (verificationGuard) {
    throw new Error("Extension popups are unavailable during verification.");
  }
  if (!win || win.isDestroyed()) {
    throw new Error("The Zenmium window is not ready.");
  }
  closeExtensionPopup();
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session,
    },
  });
  popup = view;
  view.webContents.once("destroyed", () => {
    if (popup === view && win && !win.isDestroyed()) {
      popup = null;
      win.contentView.removeChildView(view);
    }
  });
  view.webContents.on("did-fail-load", (_event, _code, _desc, _url, main) => {
    if (main) {
      closeExtensionPopup();
    }
  });
  win.contentView.addChildView(view);
  win.on("resize", extensionPopupResizeHandler);
  return view.webContents
    .loadURL(action.url)
    .then(() => {
      sizeExtensionPopup();
      view.webContents.focus();
    })
    .catch((error: unknown) => {
      closeExtensionPopup();
      throw error;
    });
}
function queueOpen(item: { url?: string; path?: string }): void {
  if (!primaryInstance) {
    return;
  }
  if (verificationGuard) {
    verificationGuard.stop();
    return;
  }
  if (pendingOpen.length < 64) {
    pendingOpen.push(item);
  }
  if (app.isReady() && !win) {
    ensureWindow();
  }
  drainOpen();
}
function drainOpen(): void {
  if (verificationGuard) {
    if (!(readyForLinks && win)) {
      return;
    }
    pendingOpen.length = 0;
    verificationGuard.present(win);
    return;
  }
  if (!(readyForLinks && arc && win)) {
    return;
  }
  while (pendingOpen.length) {
    const item = pendingOpen.shift()!;
    try {
      if (item.url) {
        arc.newTab({ url: item.url });
      } else if (item.path) {
        arc.openLocalFile(item.path);
      }
    } catch {
      chrome?.broadcast(CHROME_IPC.commandEvent, {
        error: "The requested file or URL could not be opened.",
      });
    }
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
}
app.on("open-url", (event, input) => {
  event.preventDefault();
  const url = webUrl(input);
  if (primaryInstance && url) {
    queueOpen({ url });
  }
});
app.on("open-file", (event, path) => {
  event.preventDefault();
  if (primaryInstance) {
    queueOpen({ path });
  }
});
app.on("second-instance", (_event, argv) => {
  if (!primaryInstance) {
    return;
  }
  if (verificationGuard) {
    verificationGuard.stop();
    return;
  }
  for (const argument of argv) {
    const url = webUrl(argument);
    if (url) {
      queueOpen({ url });
    }
  }
  if (win) {
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
  } else {
    ensureWindow();
  }
});

function disposeWindowServices(): void {
  readyForLinks = false;
  unsubscribeProfiles?.();
  closeExtensionPopup();
  chat?.dispose();
  chat = null;
  authentication?.dispose();
  authentication = null;
  control?.dispose();
  control = null;
  void controlBridge?.close();
  controlBridge = null;
  bridgeStarting = null;
  chatGrants.clear();
  void agent?.stop();
  agent = null;
  permissions?.dispose();
  permissions = null;
  blocking?.dispose();
  blocking = null;
  downloads?.dispose();
  downloads = null;
  for (const { host } of profileHosts.values()) {
    void host.dispose();
  }
  profileHosts.clear();
  native = null;
}

function createWindow(): void {
  const placement = verificationGuard?.placement();
  if (verificationGuard && !placement) {
    return;
  }
  creatingVerificationWindow = Boolean(verificationGuard);
  try {
    win = new BrowserWindow({
      backgroundColor: "#111315",
      height: 900,
      minHeight: 560,
      minWidth: 800,
      title: "Zenmium",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 12, y: 16 },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(import.meta.dirname, "../preload/index.cjs"),
        sandbox: true,
        ...(verification ? { disableDialogs: true } : {}),
      },
      width: 1440,
      ...(placement
        ? {
            ...placement.bounds,
            focusable: false,
            fullscreenable: false,
            maximizable: false,
            minimizable: false,
            movable: false,
            resizable: false,
            show: false,
            skipTaskbar: true,
          }
        : {}),
    });
  } finally {
    creatingVerificationWindow = false;
  }
  if (verificationGuard && !verificationGuard.placement()) {
    return;
  }
  // The sidebar renders its own traffic-light strip so the controls remain available
  // in fullscreen and when the full sidebar is temporarily revealed over the page.
  if (process.platform === "darwin") {
    win.setWindowButtonVisibility(false);
  }

  arc = new ArcCore(win, app.getPath("userData"));
  chrome = new BrowserChrome(win, arc, app.getPath("userData"));
  hardenWindow(win, (url) => arc?.newTab({ url }));

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  win.webContents.once("did-finish-load", () => {
    if (verificationGuard && !verificationGuard.placement()) {
      return;
    }
    arc?.boot();
    readyForLinks = true;
    drainOpen();
  });
  win.on("closed", () => {
    disposeWindowServices();
    chrome?.dispose();
    chrome = null;
    arc?.dispose();
    arc = null;
    win = null;
  });
}

function ensureWindow(): void {
  if (!primaryInstance || win) {
    return;
  }
  if (verificationGuard && !verificationGuard.placement()) {
    return;
  }
  createWindow();
  if (verificationGuard && !verificationGuard.placement()) {
    return;
  }
  initializeWindowServices();
}

function wireIpc(): void {
  const core = () => {
    if (!arc) {
      throw new Error("ArcCore not ready");
    }
    return arc;
  };
  const handle: typeof ipcMain.handle = (channel, listener) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!chrome?.owns(event.sender)) {
        throw new Error(
          "Browser commands are available only to trusted browser chrome."
        );
      }
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
    const { id, spaceId, confirmReload } = z
      .object({
        confirmReload: z.boolean().optional(),
        id: z.string(),
        spaceId: z.string(),
      })
      .parse(p);
    return core().moveTabToSpace(id, spaceId, { confirmReload });
  });
  handle(ARC_IPC.clearHistory, () => core().clearHistory());
  handle(ARC_IPC.closePeek, () => core().closePeek());
  handle(ARC_IPC.promotePeek, () => core().promotePeek());
  handle(NATIVE_IPC.snapshot, () => native?.snapshot());
  handle(NATIVE_IPC.bookmark, (_e, p) => {
    if (!native) {
      throw new Error("Native browser services are not ready.");
    }
    const command = bookmarkCommandSchema.parse(p);
    if (["import", "export"].includes(command.action)) {
      requireNativeDialogs();
    }
    return native.bookmark(command);
  });
  handle(NATIVE_IPC.utility, (_e, p) => {
    if (!native) {
      throw new Error("Native browser services are not ready.");
    }
    const command = utilityCommandSchema.parse(p);
    if (
      ["print", "save-pdf", "save-page", "set-default-browser"].includes(
        command.action
      )
    ) {
      requireNativeDialogs();
    }
    return native.utility(command);
  });
  handle(NATIVE_IPC.permission, (_e, p) => {
    if (!native) {
      throw new Error("Native browser services are not ready.");
    }
    return native.permission(p);
  });
  handle(NATIVE_IPC.onboarding, (_e, p) => {
    if (!native) {
      throw new Error("Native browser services are not ready.");
    }
    return native.updateOnboarding(p);
  });
  handle(NATIVE_IPC.protection, (_e, p) => {
    if (!native) {
      throw new Error("Native browser services are not ready.");
    }
    return native.protection(p);
  });

  handle(CONTROL_IPC.pair, (_e, p) => {
    if (!control) {
      throw new Error("Browser control is not ready.");
    }
    return control.createGrant(controlGrantSchema.parse(p));
  });
  handle(CONTROL_IPC.revoke, (_e, p) => {
    if (!control) {
      throw new Error("Browser control is not ready.");
    }
    const { grantId } = z
      .object({ grantId: z.string().min(1).max(160) })
      .parse(p);
    control.revokeGrant(grantId);
  });
  handle(CONTROL_IPC.grants, () => {
    if (!control) {
      throw new Error("Browser control is not ready.");
    }
    return control.listGrants();
  });
  handle(CONTROL_IPC.createSession, (_e, p) => {
    if (!control) {
      throw new Error("Browser control is not ready.");
    }
    const { token, input } = z
      .object({
        input: controlSessionInputSchema,
        token: z.string().min(1).max(256),
      })
      .parse(p);
    return control.createSession(token, input);
  });
  handle(CONTROL_IPC.execute, (_e, p) => {
    if (!control) {
      throw new Error("Browser control is not ready.");
    }
    const { token, command } = z
      .object({
        command: z.unknown(),
        token: z.string().min(1).max(256),
      })
      .parse(p);
    return control.execute(token, command);
  });
  handle(CONTROL_IPC.takeover, (_e, p) => {
    if (!control) {
      throw new Error("Browser control is not ready.");
    }
    const { sessionId } = z
      .object({ sessionId: z.string().min(1).max(160) })
      .parse(p);
    control.takeover(sessionId);
  });
  handle(CONTROL_IPC.resume, (_e, p) => {
    if (!control) {
      throw new Error("Browser control is not ready.");
    }
    const { token, sessionId } = z
      .object({
        sessionId: z.string().min(1).max(160),
        token: z.string().min(1).max(256),
      })
      .parse(p);
    return control.resume(token, sessionId);
  });
  handle(CONTROL_IPC.events, (_e, p) => {
    if (!control) {
      throw new Error("Browser control is not ready.");
    }
    const input = z
      .object({
        after: z.number().int().nonnegative().optional(),
        epoch: z.string().optional(),
        token: z.string().min(1).max(256),
      })
      .parse(p);
    return control.events(input.token, input);
  });
  handle(CONTROL_IPC.status, () => {
    if (!control) {
      throw new Error("Browser control is not ready.");
    }
    return control.capabilities();
  });

  const chatUnavailable = {
    ok: false as const,
    reason: "Agent chat is unavailable.",
    seam: "agent" as const,
  };
  for (const channel of [
    CHAT_IPC.list,
    CHAT_IPC.get,
    CHAT_IPC.create,
    CHAT_IPC.prompt,
    CHAT_IPC.abort,
    CHAT_IPC.retry,
    CHAT_IPC.resume,
    CHAT_IPC.rename,
    CHAT_IPC.models,
    CHAT_IPC.context,
    CHAT_IPC.attach,
    CHAT_IPC.removeAttachment,
    CHAT_IPC.takeover,
  ]) {
    handle(channel, (_e, p) => chat?.handle(channel, p) ?? chatUnavailable);
  }
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
        chatId: z.string().optional(),
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
  handle(CHROME_IPC.chatHistory, (_e, p) => {
    chrome?.updateChatHistory(
      z
        .object({
          action: z.enum(["upsert", "rename", "remove"]),
          id: z.string(),
          messages: z
            .array(
              z.object({
                from: z.enum(["user", "assistant"]),
                id: z.string(),
                text: z.string(),
              })
            )
            .optional(),
          spaceId: z.string().optional(),
          title: z.string().optional(),
          updatedAt: z.number().optional(),
        })
        .parse(p)
    );
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
    if (p === "minimize") {
      win?.minimize();
    } else if (p === "maximize" && win) {
      win.isMaximized() ? win.unmaximize() : win.maximize();
    } else if (p === "close") {
      win?.close();
    }
  });
  handle(CHROME_IPC.extensionLoad, async () => {
    requireNativeDialogs();
    const services = activeProfileServices();
    if (!(win && services)) {
      return;
    }
    const chosen = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Load unpacked extension",
    });
    const path = chosen.filePaths[0];
    if (chosen.canceled || !path) {
      return;
    }
    const manifest = JSON.parse(
      await readFile(join(path, "manifest.json"), "utf8")
    ) as { name?: string; version?: string };
    return services.host.load({
      enabled: true,
      id: path,
      name: manifest.name ?? "Extension",
      path,
      version: manifest.version ?? "0",
    });
  });

  handle(EXTENSION_IPC.list, () => activeProfileServices()?.host.list() ?? []);
  handle(EXTENSION_IPC.setEnabled, (_e, p) => {
    const { id: extId, enabled } = p as { id: string; enabled: boolean };
    return activeProfileServices()?.host.setEnabled(extId, enabled);
  });
  handle(EXTENSION_IPC.setPinned, (_e, p) => {
    const { id: extId, pinned } = p as { id: string; pinned: boolean };
    return activeProfileServices()?.host.setPinned(extId, pinned);
  });
  handle(EXTENSION_IPC.remove, (_e, p) =>
    activeProfileServices()?.host.remove((p as { id: string }).id)
  );
  handle(CHROME_IPC.extensionTrigger, (_e, p) => {
    const { id: extId, tabId } = p as { id: string; tabId?: number };
    return activeProfileServices()?.host.triggerAction(extId, tabId);
  });
  handle(STORE_INSTALL_IPC.start, (_e, p) =>
    activeProfileServices()?.installer.start(String(p))
  );
  handle(STORE_INSTALL_IPC.cancel, () => {
    activeProfileServices()?.installer.cancel();
  });

  handle(AGENT_IPC.newSession, () => agent?.newSession());
  handle(AGENT_IPC.prompt, (_e, p) => {
    const { sessionId, text } = p as { sessionId: string; text: string };
    return agent?.prompt(sessionId, text);
  });
  handle(AGENT_IPC.abort, (_e, p) =>
    agent?.abort((p as { sessionId: string }).sessionId)
  );
}

function initializeWindowServices(): void {
  if (!(win && arc && chrome)) {
    throw new Error("Zenmium window services could not be created.");
  }
  agent = new AgentKernel({ events });
  const userDataDir = app.getPath("userData");
  permissions = new BrowserPermissions(userDataDir, {
    changed: () => native?.changed(),
    mayPrompt: (wc) => !verification && arc?.getActiveWebContents() === wc,
    trustedChrome: (wc) => chrome?.owns(wc) ?? false,
    window: () => win,
  });
  blocking = new BrowserBlocking(userDataDir, () => native?.changed());
  downloads = new BrowserDownloads(app.getPath("userData"), (completed) => {
    if (chrome) {
      chrome.broadcast(CHROME_IPC.event, chrome.snapshot());
    }
    if (completed?.state === "completed") {
      browserNotification({
        description: basename(completed.filename),
        id: `download:${completed.id}`,
        kind: "success",
        title: "Download complete",
      });
    } else if (completed?.state === "interrupted") {
      browserNotification({
        description: basename(completed.filename),
        id: `download:${completed.id}`,
        kind: "warning",
        title: "Download interrupted",
      });
    }
  });
  authentication = new AuthenticationBroker({
    isCurrentTarget: async (scope) => {
      const current = control?.getSessionForTab(scope.tabId);
      const wc = arc?.getWebContentsForTab(scope.tabId);
      if (
        !current ||
        current.id !== scope.agentSessionId ||
        current.controller !== "agent" ||
        current.workspaceId !== scope.workspaceId ||
        current.profileId !== scope.profileId ||
        !wc ||
        wc.isDestroyed()
      ) {
        return false;
      }
      try {
        return new URL(wc.getURL()).origin === scope.origin;
      } catch {
        return false;
      }
    },
  });
  control = new BrowserControlService(arc, {
    authenticate: async (request) => {
      if (!authentication) {
        return { status: "unavailable" };
      }
      const result = await authentication.request({
        actorId: request.actorId,
        agentSessionId: request.sessionId,
        origin: request.origin,
        profileId: request.profileId,
        tabId: request.tabId,
        workspaceId: request.workspaceId,
      });
      if (result.status === "authenticated") {
        return { status: "filled" };
      }
      if (
        result.status === "awaiting-consent" ||
        result.status === "awaiting-unlock" ||
        result.status === "needs-user"
      ) {
        return { status: "awaiting-user" };
      }
      if (result.status === "denied") {
        return { status: "denied" };
      }
      if (result.status === "cancelled") {
        return { status: "cancelled" };
      }
      if (result.status === "expired") {
        return { status: "expired" };
      }
      return { status: "unavailable" };
    },
    driver: new NativeBrowserControlDriver(),
    isProtectedTarget: (profileId, tabId) =>
      authentication?.isProtectedTarget(profileId, tabId) ?? false,
    stateFile: join(userDataDir, "zenmium", "browser-control.v1.json"),
  });
  const storageCodec = safeStorage.isEncryptionAvailable()
    ? {
        decrypt: (value: Uint8Array) =>
          safeStorage.decryptString(Buffer.from(value)),
        encrypt: (value: string) => safeStorage.encryptString(value),
      }
    : undefined;
  chromeCredentialStore = new ChromeCredentialStore(
    join(userDataDir, "zenmium"),
    storageCodec
  );
  native = new NativeBrowserServices(
    win,
    arc,
    userDataDir,
    permissions,
    blocking,
    (channel, payload) => chrome?.broadcast(channel, payload),
    (tabId) => humanTab(tabId),
    {
      importChromeCredentials: importChromeCredentialsForSpace,
      importChromeExtensions: importChromeExtensionsForSpace,
      storageCodec,
    }
  );
  unsubscribeProfiles = arc.onSessionCreated((entry) =>
    attachWorkspaceSession(entry)
  );
  chrome.setHumanInputHandler((wc) =>
    humanTab(arc?.getTabIdForWebContents(wc.id))
  );
  chrome.setNativeCommandHandler((command) => {
    if (!native) {
      return false;
    }
    const utility =
      command === "zoom-in" ||
      command === "zoom-out" ||
      command === "zoom-reset"
        ? command
        : null;
    if (!utility) {
      return false;
    }
    void native.utility({ action: utility }).catch((error) => {
      chrome?.broadcast(CHROME_IPC.commandEvent, {
        error:
          error instanceof Error
            ? error.message
            : "The browser utility failed.",
      });
    });
    return true;
  });
  chat = new AgentChatManager({
    adapters: {
      bookmarks: async (spaceId) => {
        const profileId = arc?.getProfileId(spaceId);
        if (!profileId) {
          return [];
        }
        return native!.bookmarks
          .list(profileId)
          .filter(
            (bookmark) => bookmark.kind === "bookmark" && Boolean(bookmark.url)
          )
          .map((bookmark) => ({ title: bookmark.title, url: bookmark.url! }));
      },
      capturePage: async (spaceId, requestedTabId) => {
        if (!arc) {
          throw new Error("Browser is not ready.");
        }
        const state = arc.snapshot();
        const tabId = requestedTabId ?? state.activeTabId;
        if (!tabId) {
          throw new Error("There is no active page to capture.");
        }
        const tab = state.tabs.find(
          (candidate) => candidate.id === tabId && candidate.spaceId === spaceId
        );
        const wc = tabId ? arc.getWebContentsForTab(tabId) : undefined;
        if (!(tab && wc) || wc.isDestroyed()) {
          throw new Error("The requested Workspace page is unavailable.");
        }
        const value = (await wc.executeJavaScript(
          `(() => {
          const root = document.body ? document.body.cloneNode(true) : document.documentElement.cloneNode(true);
          root.querySelectorAll?.("input,textarea,select,button,script,style,noscript,[contenteditable],[aria-hidden=true]").forEach((node) => node.remove());
          return {
            title: document.title,
            url: location.href,
            text: (root.textContent || "").replace(/\\s+/g, " ").trim().slice(0, ${CHAT_LIMITS.pageText}),
          };
        })()`,
          true
        )) as { title?: unknown; url?: unknown; text?: unknown };
        return {
          tabId,
          text: String(value.text ?? ""),
          title: String(value.title ?? tab.title ?? "Current page"),
          url: String(value.url ?? tab.url),
        };
      },
      isEnabled: () => native?.isAgentEnabled() ?? false,
      pickFiles: async () => {
        requireNativeDialogs();
        if (!win) {
          return [];
        }
        const chosen = await dialog.showOpenDialog(win, {
          properties: ["openFile", "multiSelections"],
          title: "Attach to Zenmium Agent",
        });
        if (chosen.canceled) {
          return [];
        }
        const paths = chosen.filePaths.slice(0, CHAT_LIMITS.attachments);
        const files = [];
        for (const path of paths) {
          const info = await stat(path);
          if (info.size > CHAT_LIMITS.attachmentBytes) {
            throw new Error(`${basename(path)} is larger than 10 MB.`);
          }
          files.push({
            bytes: new Uint8Array(await readFile(path)),
            filename: basename(path),
            mime: attachmentMime(path),
          });
        }
        return files;
      },
      prepareBrowser: async ({
        conversationId,
        spaceId,
        runtimeSessionId,
        mode,
      }) => {
        if (!(control && native && arc)) {
          throw new Error("Browser control is unavailable.");
        }
        const existing = chatGrants.get(conversationId);
        if (existing) {
          try {
            control.validateToken(existing.token);
            if (mode === "resume") {
              await control.reobserveAndResume(
                existing.token,
                existing.sessionId
              );
            }
            const server = await bridge();
            return {
              headers: { Authorization: `Bearer ${existing.token}` },
              name: "zenmium_browser",
              systemContext:
                "This conversation owns one background tab in the current Workspace. Keep the tab in its generated group, work without focusing the window, and stop immediately if human control is shown.",
              toolNames: [
                "zenmium_browser_zenmium_capabilities",
                "zenmium_browser_zenmium_session",
                "zenmium_browser_zenmium_action",
                "zenmium_browser_zenmium_events",
              ],
              url: server.url,
            };
          } catch {
            chatGrants.delete(conversationId);
          }
        }
        const grant = control.createGrant({
          actorId: `chat:${conversationId}`,
          allowAdditionalTabs: false,
          capabilities: [
            "observe",
            "navigate",
            "interact",
            "tabs",
            "downloads",
            "authenticate",
            "cdp",
          ],
          ttlMs: 8 * 60 * 60 * 1000,
          workspaceIds: [spaceId],
        });
        const workspace = arc
          .snapshot()
          .spaces.find((space) => space.id === spaceId);
        const session = control.createSession(grant.token, {
          conversationId,
          requestId: `${conversationId}:${runtimeSessionId}:${randomUUID()}`,
          title: `Agent · ${workspace?.name ?? "Workspace"}`,
          workspaceId: spaceId,
        });
        chatGrants.set(conversationId, {
          grantId: grant.grantId,
          sessionId: session.id,
          token: grant.token,
        });
        const server = await bridge();
        return {
          headers: { Authorization: `Bearer ${grant.token}` },
          name: "zenmium_browser",
          systemContext:
            "This conversation owns one background tab in the current Workspace. Keep the tab in its generated group, work without focusing the window, and stop immediately if human control is shown.",
          toolNames: [
            "zenmium_browser_zenmium_capabilities",
            "zenmium_browser_zenmium_session",
            "zenmium_browser_zenmium_action",
            "zenmium_browser_zenmium_events",
          ],
          url: server.url,
        };
      },
      spaceExists: (spaceId) =>
        Boolean(arc?.snapshot().spaces.some((space) => space.id === spaceId)),
      takeover: async (conversationId) => {
        const grant = chatGrants.get(conversationId);
        if (grant) {
          control?.takeover(grant.sessionId);
        }
      },
    },
    directory: join(userDataDir, "zenmium"),
    kernel: agent,
    legacyHistory: chrome.snapshot().chatHistory,
    storageCodec,
  });
  chat.onChange((change) => chrome?.broadcast(CHAT_IPC.event, change));
  control.subscribe((event) => chrome?.broadcast(CONTROL_IPC.event, event));
  if (!ipcWired) {
    wireIpc();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Zenmium",
          submenu: [
            { label: "About Zenmium", role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { label: "Hide Zenmium", role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { label: "Quit Zenmium", role: "quit" },
          ],
        },
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

    events.on(EXTENSION_IPC.progress, (payload) => {
      chrome?.broadcast(EXTENSION_IPC.progress, payload);
      const progress = payload as {
        name?: unknown;
        reason?: unknown;
        status?: unknown;
      };
      if (progress.status === "error") {
        browserNotification({
          description:
            typeof progress.reason === "string"
              ? progress.reason
              : "Open Extensions to review this item.",
          id: `extension:error:${String((payload as { id?: unknown }).id ?? "unknown")}`,
          kind: "error",
          title: `${typeof progress.name === "string" ? progress.name : "Extension"} unavailable`,
        });
      }
    });
    events.on(EXTENSION_IPC.registryChanged, (payload) =>
      chrome?.broadcast(CHROME_IPC.extensionRegistryChanged, payload)
    );
    events.on(STORE_INSTALL_IPC.progress, (payload) => {
      chrome?.broadcast(STORE_INSTALL_IPC.progress, payload);
      const progress = payload as {
        id?: unknown;
        name?: unknown;
        reason?: unknown;
        stage?: unknown;
      };
      if (progress.stage === "done") {
        browserNotification({
          description: "The extension is ready in this Workspace.",
          id: `store-install:${String(progress.id ?? "unknown")}`,
          kind: "success",
          title: `${typeof progress.name === "string" ? progress.name : "Extension"} installed`,
        });
      } else if (progress.stage === "error") {
        browserNotification({
          description:
            typeof progress.reason === "string"
              ? progress.reason
              : "Open Extensions to retry.",
          id: `store-install:error:${String(progress.id ?? "unknown")}`,
          kind: "error",
          title: "Extension install failed",
        });
      }
    });
    ipcWired = true;
  }
  agent.onEvent((event) => chrome?.broadcast(AGENT_IPC.event, event));

  if (!(activateWired || verificationGuard)) {
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        ensureWindow();
      }
    });
    activateWired = true;
  }
}

app.whenReady().then(() => {
  if (!primaryInstance) {
    return;
  }
  if (verificationGuard) {
    screen.on("display-added", () => verificationGuard.stop());
    screen.on("display-removed", () => verificationGuard.stop());
    screen.on("display-metrics-changed", () => verificationGuard.stop());
    if (!verificationGuard.placement()) {
      return;
    }
  }
  app.setName("Zenmium");
  installSecurityPolicy();
  ensureWindow();
});

app.on("window-all-closed", () => {
  if (verificationGuard || process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  disposeWindowServices();
  void agent?.stop();
  arc?.dispose();
});
