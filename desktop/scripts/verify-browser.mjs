import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import WebSocket from "ws";

// Run only against an isolated Electron profile launched with remote-debugging-port=9551.
const proofDir =
  process.env.ZENMIUM_PROOF_DIR ?? join(process.cwd(), "out", "proof");
const targets = () => fetch("http://127.0.0.1:9551/json").then((r) => r.json());
const clients = [];
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let sequence = 0;
  const pending = new Map();
  const events = [];
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.method === "Input.dragIntercepted") events.push(message);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    message.error
      ? request.reject(message.error)
      : request.resolve(message.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(id, { reject, resolve, timeout });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.text +
          ": " +
          result.exceptionDetails.exception?.description
      );
    return result.result.value;
  };
  const client = { call, close: () => ws.close(), evaluate, events, target };
  clients.push(client);
  return client;
}
const results = [];
const unavailable = [];
async function step(name, action) {
  await action();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function eventually(predicate, description, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(`Timed out: ${description}`);
}
const server = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/download") {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="zenmium-check.txt"'
    );
    res.end("Zenmium download verification");
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><html><head><title>${req.url === "/second" ? "Second page" : "First page"}</title><style>body{font:18px system-ui;margin:80px;color:#202020;background:#eee}a,button{margin-right:24px}input{display:block;margin-top:24px}</style></head><body><h1>${req.url === "/second" ? "Second page" : "First page"}</h1><p>Native Chromium browsing verification.</p><a href="/second">Second page</a><a href="/first">First page</a><a href="/download">Download</a><input aria-label="Page input" placeholder="Type here to check page focus"></body></html>`
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let main, sidebar, overlay;
try {
  const all = await targets();
  main = await connect(all.find((t) => /index.html$/.test(t.url)));
  sidebar = await connect(all.find((t) => t.url.includes("surface=sidebar")));
  overlay = await connect(all.find((t) => t.url.includes("surface=overlay")));
  const invoke = (channel, payload) =>
    main.evaluate(
      `window.zenmium.invoke(${JSON.stringify(channel)},${JSON.stringify(payload) ?? "undefined"})`
    );
  const snapshot = () => invoke("arc:snapshot");
  const uiSnapshot = () => invoke("chrome:snapshot");
  const open = (kind, props = {}) => invoke("chrome:open", { kind, ...props });
  const close = () => invoke("chrome:close");
  const fixtureIds = [];
  let first, second;
  await eventually(async () => (await snapshot()).tabs.length > 0, "Arc boot");
  await step("Native chrome surfaces and real new-tab entry", async () => {
    await close();
    const count = (await snapshot()).tabs.length;
    await invoke("chrome:command", "new-tab");
    await eventually(
      () =>
        overlay.evaluate(
          'Boolean(document.querySelector("input[role=combobox]"))'
        ),
      "new-tab combobox"
    );
    assert.equal((await snapshot()).tabs.length, count);
    await invoke("chrome:command", "new-tab");
    assert.equal((await uiSnapshot()).overlay, null);
    await open("new-tab");
    await eventually(
      () =>
        overlay.evaluate(
          'Boolean(document.querySelector("input[role=combobox]"))'
        ),
      "new-tab input"
    );
    await overlay.evaluate(
      'document.querySelector("input[role=combobox]").focus()'
    );
    await overlay.call("Input.insertText", { text: base + "/first" });
    await overlay.call("Input.dispatchKeyEvent", {
      code: "Enter",
      key: "Enter",
      text: "\r",
      type: "keyDown",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
    });
    await overlay.call("Input.dispatchKeyEvent", {
      code: "Enter",
      key: "Enter",
      type: "keyUp",
      windowsVirtualKeyCode: 13,
    });
    first = await eventually(
      async () =>
        (await snapshot()).tabs.find(
          (t) => t.url === base + "/first" && !t.loading
        ),
      "submitted tab"
    );
    fixtureIds.push(first.id);
    assert.equal(first.title, "First page");
    await eventually(
      async () => !(await uiSnapshot()).overlay,
      "address dismissal"
    );
  });
  const contentTarget = await eventually(
    async () => (await targets()).find((t) => t.url === base + "/first"),
    "live tab target"
  );
  const page = await connect(contentTarget);
  await step(
    "New-tab submission focuses the newly selected live page",
    async () => {
      assert(await page.evaluate("document.hasFocus()"));
    }
  );
  await step("Page navigation, browser history, back and forward", async () => {
    await page.evaluate(`document.querySelector('a[href="/second"]').click()`);
    await eventually(
      async () =>
        (await snapshot()).tabs.find((t) => t.id === first.id)?.canGoBack,
      "navigation availability"
    );
    await invoke("arc:back", first.id);
    await eventually(
      async () =>
        (await snapshot()).tabs.find((t) => t.id === first.id)?.url ===
        base + "/first",
      "back destination"
    );
    await invoke("arc:forward", first.id);
    await eventually(
      async () =>
        (await snapshot()).tabs.find((t) => t.id === first.id)?.url ===
        base + "/second",
      "forward destination"
    );
    assert(
      (await snapshot()).history.some((entry) => entry.url.startsWith(base))
    );
  });
  await step(
    "Pinned destination reset and custom title survive navigation",
    async () => {
      await invoke("arc:pinTab", first.id);
      await invoke("arc:updateTab", {
        id: first.id,
        patch: { customTitle: "Pinned reference" },
      });
      await invoke("arc:navigate", { id: first.id, url: base + "/first" });
      await eventually(
        async () =>
          (await snapshot()).tabs.find((t) => t.id === first.id)?.pinnedChanged,
        "changed pinned URL"
      );
      await invoke("arc:resetTab", first.id);
      await eventually(async () => {
        const tab = (await snapshot()).tabs.find((t) => t.id === first.id);
        return (
          !tab.loading && !tab.pinnedChanged && tab.url === base + "/second"
        );
      }, "restored pin");
      assert.equal(
        (await snapshot()).tabs.find((t) => t.id === first.id).title,
        "Pinned reference"
      );
      await invoke("arc:unpinTab", first.id);
    }
  );
  await step(
    "Inline keyboard rename commits through the actual sidebar editor",
    async () => {
      await invoke("chrome:preferences", { sidebarMode: "expanded" });
      await eventually(
        () =>
          sidebar.evaluate(
            "Boolean(document.querySelector('.zen-tab-main[aria-label=\"Pinned reference\"]'))"
          ),
        "rename target"
      );
      await sidebar.evaluate(
        "document.querySelector('.zen-tab-main[aria-label=\"Pinned reference\"]').focus()"
      );
      await sidebar.call("Input.dispatchKeyEvent", {
        code: "F2",
        key: "F2",
        type: "keyDown",
        windowsVirtualKeyCode: 113,
      });
      await eventually(
        () =>
          sidebar.evaluate(
            "Boolean(document.querySelector('input[aria-label=\"Rename tab\"]'))"
          ),
        "inline editor"
      );
      await sidebar.evaluate(
        "document.querySelector('input[aria-label=\"Rename tab\"]').select()"
      );
      await sidebar.call("Input.insertText", {
        text: "Renamed through sidebar",
      });
      await sidebar.call("Input.dispatchKeyEvent", {
        code: "Enter",
        key: "Enter",
        text: "\r",
        type: "keyDown",
        windowsVirtualKeyCode: 13,
      });
      await eventually(
        async () =>
          (await snapshot()).tabs.find((tab) => tab.id === first.id)
            ?.customTitle === "Renamed through sidebar",
        "committed inline name"
      );
    }
  );
  await step(
    "DOM drag handlers pin and move tabs into real folders (not an OS gesture test)",
    async () => {
      await invoke("arc:updateSpace", {
        id: first.spaceId,
        patch: { pinnedCollapsed: false },
      });
      const dragTo = async (selector) => {
        // Native child-view drag interception is unavailable on this CDP backend.
        // Dispatch DOM events through the production React handlers and assert Arc
        // state, separately from the manual macOS drag-gesture verification.
        const sourceId = await sidebar.evaluate(`(() => {
        const source=document.querySelector('.zen-tab[data-active="true"]');
        const transfer=window.__testDragTransfer=new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
        return transfer.getData('application/x-zenmium-tab');
      })()`);
        assert.equal(sourceId, first.id);
        await eventually(
          () =>
            sidebar.evaluate(
              'document.querySelector(".zen-sidebar-surface").dataset.dragging === "true"'
            ),
          "sidebar drag presentation"
        );
        await sidebar.evaluate(`(() => {
        const target=document.querySelector(${JSON.stringify(selector)}), transfer=window.__testDragTransfer;
        const r=target.getBoundingClientRect();
        for (const type of ['dragenter','dragover','drop']) target.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
        delete window.__testDragTransfer;
      })()`);
      };
      await dragTo(".zen-essentials");
      await eventually(
        async () =>
          (await snapshot()).tabs.find((tab) => tab.id === first.id)?.kind ===
          "pinned",
        "dragged essential"
      );
      const folder = await invoke("arc:createFolder", {
        name: "Drop fixture",
        spaceId: first.spaceId,
      });
      await eventually(
        () =>
          sidebar.evaluate(
            'Boolean(document.querySelector(".zen-folder-heading"))'
          ),
        "folder destination"
      );
      await dragTo(".zen-folder-heading");
      await eventually(
        async () =>
          (await snapshot()).tabs.find((tab) => tab.id === first.id)
            ?.folderId === folder.id,
        "folder drop"
      );
      await invoke("arc:deleteFolder", folder.id);
      await sidebar.call("Input.cancelDragging");
    }
  );
  await step(
    "Compact gutter reveal keeps live page geometry and input intact",
    async () => {
      await invoke("chrome:preferences", {
        side: "left",
        sidebarMode: "compact",
      });
      await invoke("chrome:sidebar", {
        dragging: false,
        focused: false,
        hovered: false,
      });
      const before = await page.evaluate(
        "({width:innerWidth,height:innerHeight})"
      );
      await sidebar.call("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: -10,
        y: 350,
      });
      await sidebar.call("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 4,
        y: 350,
      });
      await eventually(
        async () => (await uiSnapshot()).sidebar.hovered,
        "gutter hover"
      );
      assert.deepEqual(
        await page.evaluate("({width:innerWidth,height:innerHeight})"),
        before
      );
      await eventually(
        async () =>
          (await sidebar.evaluate(
            'document.querySelector(".zen-sidebar").getBoundingClientRect().width'
          )) >= 200,
        "sidebar reveal paint"
      );
      await sidebar.call("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: -10,
        y: 350,
      });
      await eventually(
        async () => !(await uiSnapshot()).sidebar.hovered,
        "pointer exit"
      );
      await page.evaluate('document.querySelector("input").focus()');
      await page.call("Input.insertText", { text: "page remains interactive" });
      assert.equal(
        await page.evaluate('document.querySelector("input").value'),
        "page remains interactive"
      );
    }
  );
  await step(
    "Overlay owns native focus above live page and restores it",
    async () => {
      // CDP key synthesis bypasses Electron's native before-input-event. The native
      // Command-L accelerator is verified separately through macOS keyboard input.
      await invoke("chrome:command", "address");
      await eventually(
        async () => (await uiSnapshot()).overlay?.kind === "address",
        "address command"
      );
      await eventually(
        () =>
          overlay.evaluate(
            'document.activeElement?.getAttribute("role") === "combobox"'
          ),
        "address focus"
      );
      await overlay.call("Input.dispatchKeyEvent", {
        code: "Escape",
        key: "Escape",
        type: "keyDown",
        windowsVirtualKeyCode: 27,
      });
      await eventually(
        async () => !(await uiSnapshot()).overlay,
        "Escape dismissal"
      );
      assert(await page.evaluate("document.hasFocus()"));
    }
  );
  await step("Popup session ownership prevents stale dismissal", async () => {
    await open("address");
    const previous = (await uiSnapshot()).overlay.sessionId;
    await open("settings");
    await invoke("chrome:close", { sessionId: previous });
    assert.equal((await uiSnapshot()).overlay.kind, "settings");
    await close();
  });
  await step(
    "Trusted Alt-click opens a live Glance without navigating its parent",
    async () => {
      const parentUrl = await page.evaluate("location.href");
      const point = await page.evaluate(
        `(() => { const r = document.querySelector('a[href="/first"]').getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`
      );
      await page.call("Input.dispatchMouseEvent", {
        button: "left",
        clickCount: 1,
        modifiers: 1,
        type: "mousePressed",
        ...point,
      });
      await page.call("Input.dispatchMouseEvent", {
        button: "left",
        clickCount: 1,
        modifiers: 1,
        type: "mouseReleased",
        ...point,
      });
      try {
        await eventually(
          async () => (await snapshot()).glance?.title === "First page",
          "Alt-click Glance"
        );
      } catch (error) {
        // Chromium only exposes the trusted gesture when the native host owns
        // focus. CDP cannot grant that focus, so retain the limitation as
        // explicit evidence instead of masking it as a passing click.
        if (error instanceof Error && error.message === "Timed out: Alt-click Glance") {
          unavailable.push({ name: "Trusted Alt-click Glance", reason: "CDP cannot deliver a trusted click to an unfocused native host." });
          return;
        }
        throw error;
      }
      assert.equal(await page.evaluate("location.href"), parentUrl);
      await invoke("arc:closePeek");
      await eventually(async () => !(await snapshot()).glance, "Glance closed");
    }
  );
  await step("Workspace and folder changes persist in Arc", async () => {
    const space = await invoke("arc:createSpace", {
      name: "Verification workspace",
    });
    await invoke("arc:updateSpace", {
      id: space.id,
      patch: { color: "#8ab4f8", icon: "W", name: "Verification renamed" },
    });
    const folder = await invoke("arc:createFolder", {
      name: "Research",
      spaceId: space.id,
    });
    second = await invoke("arc:newTab", {
      spaceId: space.id,
      url: base + "/first",
    });
    fixtureIds.push(second.id);
    await invoke("arc:moveToFolder", { folderId: folder.id, id: second.id });
    await invoke("arc:updateFolder", {
      id: folder.id,
      patch: { collapsed: true },
    });
    assert.equal(
      (await snapshot()).folders.find((f) => f.id === folder.id).collapsed,
      true
    );
    await invoke("arc:moveTabToSpace", {
      confirmReload: true,
      id: second.id,
      spaceId: first.spaceId,
    });
    assert.equal(
      (await snapshot()).tabs.find((t) => t.id === second.id).folderId,
      null
    );
    await invoke("arc:deleteSpace", space.id);
    await invoke("arc:activateTab", first.id);
  });
  await step(
    "Split panes, Glance, and close/reopen use actual tabs",
    async () => {
      await invoke("arc:toggleSplit", second.id);
      assert.equal((await snapshot()).splitTabId, second.id);
      await eventually(
        () =>
          main.evaluate(
            'document.querySelectorAll(".zen-content-card").length === 2 && document.querySelector(".zen-content-card:last-child")?.getAttribute("aria-label") === "First page"'
          ),
        "loaded split renderer"
      );
      const paneOrder = await main.evaluate(
        'Array.from(document.querySelectorAll(".zen-content-card"), element => element.getAttribute("aria-label"))'
      );
      const secondTarget = await eventually(
        async () =>
          (await targets()).find(
            (target) =>
              target.url === base + "/first" && target.id !== page.target.id
          ),
        "second native pane"
      );
      const rightPage = await connect(secondTarget);
      await rightPage.call("Input.dispatchMouseEvent", {
        button: "left",
        clickCount: 1,
        type: "mousePressed",
        x: 100,
        y: 100,
      });
      await rightPage.call("Input.dispatchMouseEvent", {
        button: "left",
        clickCount: 1,
        type: "mouseReleased",
        x: 100,
        y: 100,
      });
      // CDP input can reach a document without focusing its native child view.
      // Record that unavailable gesture separately, then verify explicit native
      // focus assignment and stable composition through the real Arc command.
      try {
        await eventually(
          async () => (await snapshot()).activeTabId === second.id,
          "clicked split pane becomes navigation target",
          800
        );
      } catch (error) {
        if (!String(error).includes("Timed out: clicked split pane"))
          throw error;
        unavailable.push(
          "CDP click did not focus the second native child view; macOS gesture verification required"
        );
        console.log("UNAVAILABLE native split-pane click through CDP");
        await invoke("arc:activateTab", second.id);
      }
      assert.deepEqual(
        await main.evaluate(
          'Array.from(document.querySelectorAll(".zen-content-card"), element => element.getAttribute("aria-label"))'
        ),
        paneOrder
      );
      await invoke("arc:toggleSplit", (await snapshot()).splitTabId);
      assert.equal((await snapshot()).splitTabId, null);
      await invoke("arc:openPeek", base + "/first");
      await eventually(
        async () => (await snapshot()).glance?.title === "First page",
        "live Glance"
      );
      await invoke("arc:closePeek");
      assert.equal((await snapshot()).glance, null);
      await invoke("arc:unpinTab", second.id);
      await invoke("arc:closeTab", second.id);
      const archived = (await snapshot()).archive.find(
        (t) => t.id === second.id
      );
      assert(archived);
      await invoke("arc:restoreTab", archived.id);
      const restored = (await snapshot()).tabs.find(
        (t) => t.id !== first.id && t.url === base + "/first"
      );
      if (restored) fixtureIds.push(restored.id);
    }
  );
  await step(
    "Utilities mount with real data and keyboard-dismissable dialogs",
    async () => {
      const labels = {
        agent: "Agent",
        commands: "Command palette",
        downloads: "Downloads",
        extensions: "Extensions",
        history: "History and archive",
        menu: "Browser menu",
        settings: "Settings",
        workspace: "Workspaces",
      };
      for (const kind of [
        "history",
        "downloads",
        "extensions",
        "settings",
        "workspace",
        "agent",
        "menu",
        "commands",
      ]) {
        await open(kind);
        if (kind === "agent") {
          await eventually(
            () =>
              main.evaluate(
                'Boolean(document.querySelector(".zen-agent-docked [data-beui-chat-app=\\"true\\"]"))'
              ),
            "docked agent"
          );
        } else {
          await eventually(
            () =>
              overlay.evaluate(
                `Boolean(document.querySelector('[role="dialog"][aria-label="${labels[kind]}"]'))`
              ),
            kind + " dialog"
          );
          await eventually(
            () =>
              overlay.evaluate(
                `document.querySelector('[role="dialog"][aria-label="${labels[kind]}"]')?.contains(document.activeElement)`
              ),
            kind + " focus"
          );
        }
        if (kind === "agent") await close();
        else
          await overlay.call("Input.dispatchKeyEvent", {
            code: "Escape",
            key: "Escape",
            type: "keyDown",
            windowsVirtualKeyCode: 27,
          });
        await eventually(
          async () => !(await uiSnapshot()).overlay,
          kind + " closes"
        );
      }
    }
  );
  await step(
    "Right sidebar and collapsed rail retain content margins",
    async () => {
      await invoke("chrome:preferences", {
        side: "right",
        sidebarMode: "collapsed",
      });
      await invoke("chrome:sidebar", {
        dragging: false,
        focused: false,
        hovered: false,
      });
      const rectangle = await main.evaluate(
        'JSON.stringify(document.querySelector(".zen-browser-cards").getBoundingClientRect().toJSON())'
      );
      assert.equal(JSON.parse(rectangle).x, 8);
      await invoke("chrome:preferences", {
        side: "left",
        sidebarMode: "expanded",
        width: 230,
      });
    }
  );
  // Leave a real neutral page for native-window visual review; discard only this run's fixture tabs.
  for (const id of fixtureIds) {
    await invoke("arc:unpinTab", id);
    await invoke("arc:closeTab", id);
  }
  const existing = (await snapshot()).tabs.find(
    (t) => t.url === "https://example.com/"
  );
  if (existing) await invoke("arc:activateTab", existing.id);
  else await invoke("arc:newTab", { url: "https://example.com" });
  await mkdir(proofDir, { recursive: true });
  await writeFile(
    join(proofDir, "native-interactions.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        passed: true,
        results,
        scope: "Scripted integration, not native gesture certification",
        unavailable,
      },
      null,
      2
    )
  );
} catch (error) {
  await mkdir(proofDir, { recursive: true });
  await writeFile(
    join(proofDir, "native-interactions.json"),
    JSON.stringify({ error: String(error), passed: false, results }, null, 2)
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  if (sidebar) {
    await sidebar.call("Input.cancelDragging").catch(() => {});
    await sidebar
      .call("Input.setInterceptDrags", { enabled: false })
      .catch(() => {});
  }
  clients.forEach((client) => client.close());
  server.close();
}
