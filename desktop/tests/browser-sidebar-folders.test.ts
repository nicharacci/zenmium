import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  type BrowserSurfaceProps,
  DEFAULT_PREFERENCES,
} from "../src/shared/browser-ui.ts";
import { emptyState } from "../src/shared/ipc.ts";

// Load the real Sidebar and its children without a bundler or Electron. Only
// CSS is stubbed: this regression must depend on inert, not collapsed geometry.
// The existing TypeScript dependency handles JSX that Node cannot strip.
const sourceRoot = new URL("../src/", import.meta.url).href;
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith(".css")) {
      return { format: "module", shortCircuit: true, source: "export {};" };
    }
    if (url.startsWith(sourceRoot) && url.endsWith(".tsx")) {
      const { outputText } = ts.transpileModule(
        readFileSync(new URL(url), "utf8"),
        {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
          fileName: fileURLToPath(url),
        }
      );
      return { format: "module", shortCircuit: true, source: outputText };
    }
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    let url: string | undefined;
    if (specifier.startsWith("@shared/")) {
      url = new URL(`shared/${specifier.slice(8)}`, sourceRoot).href;
    } else if (specifier.startsWith("@/")) {
      url = new URL(`renderer/${specifier.slice(2)}`, sourceRoot).href;
    } else if (
      specifier.startsWith(".") &&
      context.parentURL?.startsWith(sourceRoot)
    ) {
      url = new URL(specifier, context.parentURL).href;
    }
    if (url) {
      for (const suffix of ["", ".ts", ".tsx"]) {
        const candidate = `${url}${suffix}`;
        if (existsSync(new URL(candidate))) {
          return nextResolve(candidate, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
const { Sidebar } = await (async () => {
  try {
    return await import("../src/renderer/components/Sidebar.tsx");
  } finally {
    hooks.deregister();
  }
})();

function sidebarProps(collapsed: boolean): BrowserSurfaceProps {
  const state = emptyState();
  const folderId = "research";
  state.folders = [
    { collapsed, id: folderId, name: "Research", spaceId: state.activeSpaceId },
  ];
  state.tabs = ["Reference", "Notes"].map((title) => ({
    folderId,
    id: title.toLowerCase(),
    kind: "pinned",
    lastActiveAt: 0,
    loading: false,
    spaceId: state.activeSpaceId,
    title,
    url: "about:blank",
  }));
  state.activeTabId = state.tabs[0].id;
  return {
    invoke: () => {
      throw new Error("Static Sidebar rendering must not invoke IPC");
    },
    state,
    ui: {
      chatHistory: [],
      dark: true,
      overlay: null,
      preferences: { ...DEFAULT_PREFERENCES, sidebarMode: "expanded" },
      sidebar: { dragging: false, focused: false, hovered: false },
    },
  };
}

// Happy DOM enforces inert for programmatic focus, but has no browser/OS
// accessibility tree. These tests prove the native inert contract and .focus()
// behavior, not screen-reader integration, Tab traversal, CSS, or hydration.
for (const collapsed of [true, false]) {
  test(`Sidebar folder ${collapsed ? "collapsed" : "expanded"}: inert and child focus`, async () => {
    const window = new Window();
    try {
      const { document } = window;
      document.body.innerHTML = renderToStaticMarkup(
        createElement(Sidebar, sidebarProps(collapsed))
      );
      const heading = document.querySelector<HTMLButtonElement>(
        'button[aria-controls="zen-folder-research"]'
      );
      assert.ok(heading, "real folder heading must render");
      assert.equal(heading.getAttribute("aria-expanded"), String(!collapsed));
      const inner = document.getElementById(
        heading.getAttribute("aria-controls") ?? ""
      );
      assert.ok(inner, "aria-controls must resolve to the folder contents");
      const panel = inner.closest(".zen-folder-tabs");
      assert.ok(
        panel,
        "real folder panel must contain the controlled contents"
      );
      assert.equal(panel.hasAttribute("inert"), collapsed);
      assert.equal(heading.closest("[inert]"), null);
      heading.focus();
      assert.equal(document.activeElement, heading);

      const tabs = inner.querySelectorAll<HTMLButtonElement>(
        "button.zen-tab-main"
      );
      assert.equal(tabs.length, 2, "children stay mounted even when collapsed");
      for (const tab of tabs) {
        assert.equal(tab.closest("[inert]"), collapsed ? panel : null);
        tab.focus();
        assert.equal(document.activeElement, collapsed ? heading : tab);
      }
    } finally {
      await window.happyDOM.close();
    }
  });
}
