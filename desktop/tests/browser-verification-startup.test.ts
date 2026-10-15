import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  cancelVerificationMessageBox,
  containsRect,
  createVerificationGuard,
  prepareVerificationStartup,
  verificationPlacement,
  verificationRequested,
} from "../src/main/verification-startup.ts";

const primary = {
  bounds: { height: 1080, width: 1920, x: 0, y: 0 },
  id: 1,
  label: "MSI G27C5",
  rotation: 0,
  scaleFactor: 1,
  workArea: { height: 1056, width: 1920, x: 0, y: 24 },
};
const side = {
  bounds: { height: 1920, width: 1080, x: -1080, y: -400 },
  id: 2,
  label: "DELL P2422H",
  rotation: 90,
  scaleFactor: 1,
  workArea: { height: 1896, width: 1080, x: -1080, y: -376 },
};

const requireModule = createRequire(import.meta.url);
const nativeDialogError = /Native dialogs/;
const externalError =
  /External applications are unavailable during verification/;
const displayEvent = (event: string) => event.startsWith("display-");
const sharedModules = new Map<string, unknown>();
function sharedModule(name: string): unknown {
  if (!sharedModules.has(name)) {
    const source = readFileSync(
      new URL(`${name}.ts`, new URL("../src/main/", import.meta.url)),
      "utf8"
    );
    const context = { exports: {}, require: requireModule };
    runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText,
      context
    );
    sharedModules.set(name, context.exports);
  }
  return sharedModules.get(name);
}

function fixture(
  enabled: string | undefined = "1",
  lock = true,
  construct = false
) {
  const calls: string[] = [];
  const originalOpenExternal = (
    url: string,
    _options?: { activate?: boolean }
  ) => {
    calls.push(`external:${url}`);
    return Promise.resolve();
  };
  const shell = { openExternal: originalOpenExternal };
  const originalShowMessageBox = (..._args: unknown[]) => {
    calls.push("dialog:message");
    return Promise.resolve({ checkboxChecked: false, response: 0 });
  };
  const dialog = {
    showMessageBox: originalShowMessageBox,
    showOpenDialog: () => {
      calls.push("dialog:open");
      return Promise.resolve({ canceled: true, filePaths: [] });
    },
  };
  let displays = [primary, side];
  const handlers = new Map<
    string,
    (event: unknown, payload?: unknown) => unknown
  >();
  let readyContinuation: Promise<unknown> | undefined;
  let permissionOptions: { mayPrompt: (wc: unknown) => boolean } | undefined;
  let pickFiles: (() => Promise<unknown>) | undefined;
  let windowOptions: Record<string, unknown> | undefined;
  let resolveReady: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const app = Object.assign(new EventEmitter(), {
    getPath: () => "/fake/profile",
    isReady: () => false,
    quit() {
      calls.push("quit");
    },
    requestSingleInstanceLock() {
      calls.push("lock");
      return lock;
    },
    setActivationPolicy(value: string) {
      calls.push(`activation:${value}`);
    },
    setName: () => undefined,
    setPath(name: string, path: string) {
      calls.push(`${name}:${path}`);
    },
    whenReady: () => ({
      // biome-ignore lint/suspicious/noThenProperty: mirrors Electron's whenReady() thenable contract
      then(callback: () => unknown) {
        readyContinuation = readyPromise.then(callback);
        return readyContinuation;
      },
    }),
  });
  let bounds = { ...side.workArea };
  let destroyed = false;
  const window = Object.assign(new EventEmitter(), {
    close() {
      destroyed = true;
      this.emit("closed");
    },
    destroy() {
      calls.push("destroy");
    },
    focus() {
      calls.push("focus");
    },
    getBounds: () => bounds,
    hide() {
      calls.push("hide");
    },
    isDestroyed: () => destroyed,
    isMinimized: () => true,
    loadFile: () => Promise.resolve(),
    loadURL: () => Promise.resolve(),
    restore() {
      calls.push("restore");
    },
    setBounds(value: typeof bounds) {
      bounds = value;
      calls.push("bounds");
    },
    setFocusable(value: boolean) {
      calls.push(`focusable:${value}`);
    },
    setWindowButtonVisibility: () => undefined,
    show() {
      calls.push("show");
    },
    showInactive() {
      calls.push("inactive");
    },
    webContents: new EventEmitter(),
  });
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => primary,
  });
  let sequence = 0;
  const source = readFileSync(
    new URL("../src/main/index.ts", import.meta.url),
    "utf8"
  ).replaceAll("import.meta.dirname", '"/fake/build"');
  const code = ts.transpileModule(
    `${source}\nglobalThis.api = {
    drainOpen, createWindow, ensureWindow,
    seed(window, ready) { win = window; arc = {newTab() {}}; readyForLinks = ready; pendingOpen.push({url: 'https://example.com'}); },
    pending: () => pendingOpen.length,
    setReady() { readyForLinks = true; },
    guard: verificationGuard,
  };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText;
  const context = {
    api: undefined as unknown as {
      drainOpen: () => void;
      createWindow: () => void;
      ensureWindow: () => void;
      seed: (window: typeof window, ready: boolean) => void;
      pending: () => number;
      setReady: () => void;
      guard: ReturnType<typeof createVerificationGuard>;
    },
    exports: {},
    process: {
      env: enabled === "unset" ? {} : { ZENMIUM_VERIFY_SIDE_MONITOR: enabled },
      platform: "darwin",
    },
    require(name: string) {
      if (name === "electron") {
        function constructWindow(
          this: unknown,
          options: Record<string, unknown>
        ) {
          calls.push("construct");
          if (!construct) {
            throw new Error("Unexpected window construction");
          }
          windowOptions = options;
          app.emit("browser-window-created", {}, window);
          return window;
        }
        return {
          app,
          BrowserWindow: Object.assign(constructWindow, {
            getAllWindows: () => [window],
          }),
          dialog,
          ipcMain: {
            handle: (
              channel: string,
              listener: (event: unknown, payload?: unknown) => unknown
            ) => handlers.set(channel, listener),
          },
          Menu: {
            buildFromTemplate: (value: unknown) => value,
            setApplicationMenu: () => undefined,
          },
          safeStorage: { isEncryptionAvailable: () => false },
          screen,
          shell,
        };
      }
      if (name === "node:events") {
        return { EventEmitter };
      }
      if (name === "node:fs") {
        return {
          mkdtempSync: (prefix: string) => {
            sequence += 1;
            const path = `${prefix}${sequence}`;
            calls.push(`temp:${path}`);
            return path;
          },
        };
      }
      if (name === "node:os") {
        return { tmpdir: () => "/fake/tmp" };
      }
      if (name === "node:path") {
        return { join };
      }
      if (name === "./verification-startup") {
        return {
          cancelVerificationMessageBox,
          containsRect,
          createVerificationGuard,
          prepareVerificationStartup,
          verificationPlacement,
          verificationRequested,
        };
      }
      if (name === "zod") {
        return requireModule(name);
      }
      if (name.startsWith("../shared/")) {
        return sharedModule(name);
      }
      if (name === "./browser-url") {
        return {
          webUrl: (value: string) =>
            value.startsWith("https://") ? value : null,
        };
      }
      if (name === "./security") {
        return {
          BrowserPermissions: class {
            constructor(
              _path: string,
              options: NonNullable<typeof permissionOptions>
            ) {
              permissionOptions = options;
            }
            dispose() {
              // Verification fixtures never attach real session handlers.
            }
          },
          hardenWindow: () => calls.push("harden"),
          installSecurityPolicy: () => calls.push("security"),
        };
      }
      if (name === "./arc-core") {
        return {
          ArcCore: class {
            boot() {
              calls.push("boot");
            }
            dispose() {
              // No persistent fixture state to release.
            }
            getActiveWebContents() {
              return window.webContents;
            }
            onSessionCreated() {
              return () => undefined;
            }
            snapshot() {
              return { activeSpaceId: "space" };
            }
            getProfileId() {
              return "profile";
            }
            getSessionForSpace() {
              // Sessions are inert in the verification harness.
            }
          },
        };
      }
      if (name === "./browser-chrome") {
        return {
          BrowserChrome: class {
            dispose() {
              // Chrome fixtures hold no native resources.
            }
            owns() {
              return true;
            }
            snapshot() {
              return { chatHistory: [] };
            }
            setHumanInputHandler() {
              // Handler wiring is not exercised in this harness.
            }
            setNativeCommandHandler() {
              // Handler wiring is not exercised in this harness.
            }
          },
        };
      }
      if (name === "./agent-kernel") {
        return {
          AGENT_IPC: {
            abort: "agent:abort",
            newSession: "agent:new",
            prompt: "agent:prompt",
          },
          AgentKernel: class {
            onEvent() {
              // Events are not observed in this harness.
            }
            stop() {
              // No background work to stop.
            }
          },
        };
      }
      if (name === "./agent-chat-manager") {
        return {
          AgentChatManager: class {
            constructor(options: {
              adapters: { pickFiles: () => Promise<unknown> };
            }) {
              ({ pickFiles } = options.adapters);
            }
            onChange() {
              // Change events are not observed in this harness.
            }
            dispose() {
              // No persistent state to release.
            }
          },
        };
      }
      if (name === "./browser-native") {
        return {
          NativeBrowserServices: class {
            bookmark(command: { action: string }) {
              calls.push(`bookmark:${command.action}`);
            }
            utility(command: { action: string }) {
              calls.push(`utility:${command.action}`);
            }
          },
        };
      }
      if (name === "./extension-host") {
        return {
          EXTENSION_IPC: {
            list: "extension:list",
            progress: "extension:progress",
            registryChanged: "extension:registry",
            remove: "extension:remove",
            setEnabled: "extension:enabled",
            setPinned: "extension:pinned",
          },
        };
      }
      if (name === "./store-install") {
        return {
          STORE_INSTALL_IPC: {
            cancel: "store:cancel",
            progress: "store:progress",
            start: "store:start",
          },
        };
      }
      const service = class {
        dispose() {
          // Shared inert service stub.
        }
        subscribe() {
          // No event stream is wired in this harness.
        }
      };
      return {
        AuthenticationBroker: service,
        BrowserBlocking: service,
        BrowserControlService: service,
        BrowserDownloads: service,
        ChromeCredentialStore: service,
        NativeBrowserControlDriver: service,
      };
    },
  };
  runInNewContext(code, context);
  return {
    api: context.api,
    app,
    calls,
    dialog,
    invoke: (channel: string, payload?: unknown) => {
      const listener = handlers.get(channel);
      if (!listener) {
        throw new Error(`No handler registered for ${channel}`);
      }
      return listener({}, payload);
    },
    originalOpenExternal,
    originalShowMessageBox,
    permissionOptions: () =>
      permissionOptions as { mayPrompt: (wc: unknown) => boolean },
    pickFiles: () => (pickFiles as () => Promise<unknown>)(),
    ready: async () => {
      resolveReady?.();
      await readyContinuation;
    },
    screen,
    setDisplays(value: typeof displays) {
      displays = value;
    },
    shell,
    window,
    windowOptions: () => windowOptions as Record<string, unknown>,
  };
}

test("entrypoint verification drain preserves queued links until ready and never activates", () => {
  const f = fixture();
  f.api.guard.windowCreated(f.window, true);
  f.api.seed(f.window, false);
  f.api.drainOpen();
  assert.equal(f.api.pending(), 1);
  assert.equal(f.calls.includes("inactive"), false);
  f.api.setReady();
  f.api.drainOpen();
  assert.equal(f.api.pending(), 0);
  assert.deepEqual(f.calls.slice(-2), ["bounds", "inactive"]);
  assert.equal(
    f.calls.some((call) => ["show", "focus", "restore"].includes(call)),
    false
  );
});

test("entrypoint second-instance fails closed without processing arguments or activating", () => {
  const f = fixture();
  f.app.emit("second-instance", {}, ["https://example.com"]);
  assert.deepEqual(f.calls.slice(-2), ["hide", "quit"]);
  assert.equal(f.calls.includes("construct"), false);
});

test("entrypoint missing side display refuses construction", () => {
  const f = fixture();
  f.setDisplays([primary]);
  f.api.createWindow();
  assert.deepEqual(f.calls.slice(-2), ["hide", "quit"]);
  assert.equal(f.calls.includes("construct"), false);
});

test("entrypoint isolates every profile path and selects accessory policy before locking", () => {
  const f = fixture();
  assert.deepEqual(f.calls, [
    "temp:/fake/tmp/zenmium-verification-1",
    "userData:/fake/tmp/zenmium-verification-1",
    "temp:/fake/tmp/zenmium-verification-1/zenmium-verification-2",
    "sessionData:/fake/tmp/zenmium-verification-1/zenmium-verification-2",
    "temp:/fake/tmp/zenmium-verification-1/zenmium-verification-3",
    "crashDumps:/fake/tmp/zenmium-verification-1/zenmium-verification-3",
    "activation:accessory",
    "lock",
  ]);
});

test("default startup keeps the ordinary lock and drain activation behavior", () => {
  const f = fixture("unset");
  assert.deepEqual(f.calls, ["lock"]);
  f.api.seed(f.window, false);
  f.api.drainOpen();
  assert.equal(f.api.pending(), 1);
  f.api.setReady();
  f.api.drainOpen();
  assert.deepEqual(f.calls.slice(-3), ["restore", "show", "focus"]);
  assert.equal(f.app.listenerCount("browser-window-created"), 0);
});

test("invalid opt-in and denied lock never reach ready-time services or windows", async () => {
  await Promise.all(
    [fixture("true"), fixture("1", false)].map(async (f) => {
      await f.ready();
      f.api.ensureWindow();
      assert.equal(f.calls.includes("construct"), false);
      assert.equal(f.calls.includes("quit"), true);
    })
  );
  assert.equal(fixture("true").calls.includes("lock"), false);
});

test("activate and unexpected new-window lifecycle fail closed", () => {
  const activated = fixture();
  activated.app.emit("activate");
  activated.api.ensureWindow();
  assert.deepEqual(activated.calls.slice(-2), ["hide", "quit"]);
  const created = fixture();
  created.app.emit("browser-window-created", {}, created.window);
  assert.deepEqual(created.calls.slice(-3), ["hide", "quit", "destroy"]);
  assert.equal(
    created.calls.some((call) => ["show", "focus", "restore"].includes(call)),
    false
  );
});

test("verification suppresses native WebContents focus without changing normal startup", () => {
  let focus = 0;
  const contents = {
    focus: () => {
      focus += 1;
    },
  };
  fixture("unset").app.emit("web-contents-created", {}, contents);
  contents.focus();
  fixture().app.emit("web-contents-created", {}, contents);
  contents.focus();
  assert.equal(focus, 1);
});

test("verification cancels parented and parentless page message boxes before native invocation", async () => {
  const f = fixture("1", true, true);
  // Model Electron 42.11.3's shared-property lookup, not a renderer override.
  // The guard is installed before ready and persists across contents creation.
  const checkDialogs = async () => {
    const results: Array<Promise<{ checkboxChecked: boolean; response: number }>> = [];
    for (const type of ["window", "browserView", "webview", "backgroundPage"]) {
      f.app.emit(
        "web-contents-created",
        {},
        { focus: () => undefined, getType: () => type }
      );
      for (const buttons of [["OK"], ["OK", "Cancel"]]) {
        const options = { buttons, message: "Page dialog" };
        for (const args of [[options], [f.window, options]]) {
          results.push(f.dialog.showMessageBox(...args));
        }
      }
    }
    for (const result of await Promise.all(results)) {
      assert.equal(result.response === 0, false);
      assert.equal(result.checkboxChecked, false);
    }
  };
  await checkDialogs();
  await f.ready();
  await checkDialogs();
  assert.equal(f.calls.includes("dialog:message"), false);
  assert.equal(
    (f.windowOptions().webPreferences as { disableDialogs?: boolean })
      .disableDialogs,
    true
  );
  const normal = fixture("unset", true, true);
  await normal.ready();
  assert.equal(normal.dialog.showMessageBox, normal.originalShowMessageBox);
  assert.equal(
    (normal.windowOptions().webPreferences as { disableDialogs?: boolean })
      .disableDialogs,
    undefined
  );
  await normal.dialog.showMessageBox({ message: "Normal dialog" });
  assert.equal(normal.calls.includes("dialog:message"), true);
});

test("verification shell monkeypatch rejects external handoffs before delegation", async () => {
  const f = fixture();
  const normal = fixture("unset");
  await Promise.all(
    [
      "mailto:test@example.com",
      "tel:+15555550100",
      "custom-app:open",
      "https://example.com",
    ].map((url) => {
      assert.throws(
        () => f.shell.openExternal(url, { activate: true }),
        externalError
      );
      return normal.shell.openExternal(url, { activate: false });
    })
  );
  assert.equal(
    f.calls.some((call) => call.startsWith("external:")),
    false
  );
  assert.equal(normal.shell.openExternal, normal.originalOpenExternal);
  assert.equal(
    normal.calls.filter((call) => call.startsWith("external:")).length,
    4
  );
});

test("open-file and open-url refuse external input without presenting", () => {
  const f = fixture();
  f.app.emit(
    "open-file",
    { preventDefault: () => undefined },
    "/untrusted/file"
  );
  assert.deepEqual(f.calls.slice(-2), ["hide", "quit"]);
  assert.equal(f.api.pending(), 0);
});

test("display removal and changes latch refusal even after display recovery", () => {
  for (const change of [
    [primary],
    [primary, { ...side, scaleFactor: 2 }],
    [primary, { ...side, rotation: 0 }],
    [primary, { ...side, workArea: { ...side.workArea, height: 1800 } }],
  ]) {
    const f = fixture();
    f.api.guard.windowCreated(f.window, true);
    f.setDisplays(change);
    f.api.guard.present(f.window);
    f.setDisplays([primary, side]);
    f.api.guard.present(f.window);
    assert.deepEqual(f.calls.slice(-2), ["hide", "quit"]);
    assert.equal(f.calls.includes("inactive"), false);
  }
});

test("ready continuation constructs one nonactivating window and close prevents recreation", async () => {
  const f = fixture("1", true, true);
  await f.ready();
  assert.equal(f.calls.filter((call) => call === "construct").length, 1);
  assert.equal(f.calls.includes("security"), true);
  for (const key of [
    "show",
    "focusable",
    "movable",
    "resizable",
    "minimizable",
    "maximizable",
    "fullscreenable",
  ]) {
    assert.equal(f.windowOptions()[key], false);
  }
  assert.equal(f.windowOptions().skipTaskbar, true);
  for (const event of ["move", "resize", "focus", "closed"]) {
    assert.ok(f.window.listenerCount(event) > 0);
  }
  assert.equal(f.window.webContents.listenerCount("did-finish-load"), 1);
  assert.equal(f.calls.includes("inactive"), false);
  f.window.webContents.emit("did-finish-load");
  assert.deepEqual(f.calls.slice(-3), ["boot", "bounds", "inactive"]);
  f.window.close();
  f.api.ensureWindow();
  f.app.emit("activate");
  assert.equal(f.calls.filter((call) => call === "construct").length, 1);
  assert.equal(f.calls.filter((call) => call === "quit").length, 1);
  assert.equal(
    f.calls.some((call) => ["show", "focus", "restore"].includes(call)),
    false
  );
});

test("constructed window refuses movement resize focus and display lifecycle changes", async () => {
  await Promise.all(
    [
      "move",
      "resize",
      "focus",
      "display-added",
      "display-removed",
      "display-metrics-changed",
    ].map(async (event) => {
      const f = fixture("1", true, true);
      await f.ready();
      f.window.webContents.emit("did-finish-load");
      if (displayEvent(event)) {
        f.screen.emit(event);
      } else {
        f.window.setBounds(primary.bounds);
        f.window.emit(event);
      }
      assert.deepEqual(f.calls.slice(-2), ["hide", "quit"]);
      f.api.ensureWindow();
      assert.equal(f.calls.filter((call) => call === "construct").length, 1);
    })
  );
});
test("verification denies dialog operations at their entrypoint and permission seams", async () => {
  const f = fixture("1", true, true);
  await f.ready();
  assert.equal(f.permissionOptions().mayPrompt(f.window.webContents), false);
  for (const action of ["import", "export"]) {
    assert.throws(
      () => f.invoke("native:bookmark", { action }),
      nativeDialogError
    );
  }
  for (const action of [
    "print",
    "save-pdf",
    "save-page",
    "set-default-browser",
  ]) {
    assert.throws(
      () => f.invoke("native:utility", { action }),
      nativeDialogError
    );
  }
  await assert.rejects(f.pickFiles(), nativeDialogError);
  const channels = sharedModule("../shared/browser-ui") as {
    CHROME_IPC: { extensionLoad: string };
  };
  await assert.rejects(
    async () => f.invoke(channels.CHROME_IPC.extensionLoad),
    nativeDialogError
  );
  f.invoke("native:utility", { action: "zoom-in" });
  assert.equal(f.calls.includes("utility:zoom-in"), true);
  assert.equal(
    f.calls.some(
      (call) => call.startsWith("dialog:") || call.startsWith("bookmark:")
    ),
    false
  );
  const normal = fixture("unset", true, true);
  await normal.ready();
  assert.equal(
    normal.permissionOptions().mayPrompt(normal.window.webContents),
    true
  );
  await normal.pickFiles();
  assert.equal(normal.calls.includes("dialog:open"), true);
  normal.invoke("native:bookmark", { action: "import" });
  normal.invoke("native:utility", { action: "save-page" });
  assert.equal(normal.calls.includes("bookmark:import"), true);
  assert.equal(normal.calls.includes("utility:save-page"), true);
});

test("cleanup continues after hide or destruction-state failures and still quits", () => {
  for (const method of ["hide", "isDestroyed"] as const) {
    const f = fixture();
    const first = {
      ...f.window,
      getBounds: f.window.getBounds,
      hide: f.window.hide,
      isDestroyed: f.window.isDestroyed,
      setBounds: f.window.setBounds,
      showInactive: f.window.showInactive,
      [method]: () => {
        throw new Error("OS failure");
      },
    };
    const guard = createVerificationGuard({
      displays: () => ({ displays: [primary, side], primaryId: 1 }),
      quit: () => f.calls.push("quit"),
      windows: () => [first, f.window],
    });
    assert.doesNotThrow(() => guard.stop());
    assert.deepEqual(f.calls.slice(-2), ["hide", "quit"]);
    assert.equal(guard.placement(), null);
    const unexpected = fixture();
    unexpected.window[method] = () => {
      throw new Error("OS failure");
    };
    assert.doesNotThrow(() =>
      unexpected.app.emit("browser-window-created", {}, unexpected.window)
    );
    assert.equal(unexpected.calls.includes("quit"), true);
    assert.equal(unexpected.calls.includes("destroy"), true);
  }
});

test("presentation handles throwing isDestroyed and shutdown handles failed enumeration", () => {
  const f = fixture();
  f.api.guard.windowCreated(f.window, true);
  f.window.isDestroyed = () => {
    throw new Error("OS failure");
  };
  assert.doesNotThrow(() => f.api.guard.present(f.window));
  assert.deepEqual(f.calls.slice(-2), ["hide", "quit"]);
  let quits = 0;
  const guard = createVerificationGuard({
    displays: () => ({ displays: [primary, side], primaryId: 1 }),
    quit: () => {
      quits += 1;
      throw new Error("quit failed");
    },
    windows: () => {
      throw new Error("enumeration failed");
    },
  });
  assert.doesNotThrow(() => guard.stop());
  assert.equal(quits, 1);
});

test("negative monitor coordinates and exact minimum work area fit without primary overlap", () => {
  const result = verificationPlacement([primary, side], primary.id);
  assert.equal(result.bounds.x, -1080);
  assert.equal(result.bounds.width, 1080);
  assert.equal(containsRect(side.workArea, result.bounds), true);
  const tiny = {
    ...side,
    workArea: { height: 560, width: 800, x: -1080, y: -400 },
  };
  assert.deepEqual(
    verificationPlacement([primary, tiny], 1).bounds,
    tiny.workArea
  );
});

test("missing ambiguous primary mirrored invalid and tiny displays are rejected", () => {
  for (const [displays, primaryId] of [
    [[], 1],
    [[primary], 1],
    [[primary, side], 2],
    [[primary, side], 99],
    [[primary, side, { ...side, id: 3 }], 1],
    [[primary, { ...side, id: 1 }], 1],
    [[primary, { ...side, label: "Unknown" }], 1],
    [
      [
        primary,
        { ...side, bounds: primary.bounds, workArea: primary.workArea },
      ],
      1,
    ],
    [[primary, { ...side, workArea: { ...side.workArea, width: 799 } }], 1],
    [[primary, { ...side, workArea: { ...side.workArea, height: 559 } }], 1],
    [[primary, { ...side, workArea: { ...side.workArea, x: Number.NaN } }], 1],
    [[primary, { ...side, workArea: { ...side.workArea, width: 2000 } }], 1],
  ] as const) {
    assert.throws(() => verificationPlacement(displays, primaryId));
  }
});

test("isolation failure does not request a lock", () => {
  let locked = false;
  assert.throws(() =>
    prepareVerificationStartup(true, {
      createTemporaryDirectory: () => {
        throw new Error("denied");
      },
      lock: () => {
        locked = true;
        return true;
      },
      setPath: () => undefined,
      useAccessoryActivation: () => undefined,
    })
  );
  assert.equal(locked, false);
});

test("OS placement refusal and late display change prevent showInactive", () => {
  for (const mode of ["bounds", "display", "throw"]) {
    const f = fixture();
    f.api.guard.windowCreated(f.window, true);
    f.window.setBounds = () => {
      if (mode === "throw") {
        throw new Error("OS failure");
      }
      if (mode === "display") {
        f.setDisplays([primary]);
      }
    };
    f.window.getBounds = () => primary.bounds;
    f.api.guard.present(f.window);
    assert.equal(f.calls.includes("inactive"), false);
    assert.deepEqual(f.calls.slice(-2), ["hide", "quit"]);
  }
});
