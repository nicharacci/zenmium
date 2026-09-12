import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  BrowserPreferences,
  BrowserUiState,
} from "../src/shared/browser-ui.ts";
import {
  browserLayout,
  DEFAULT_PREFERENCES,
  glanceLayout,
  preferencesSchema,
  sidebarRevealed,
} from "../src/shared/browser-ui.ts";

function ui(
  preferences: Partial<BrowserPreferences> = {},
  state: Partial<Pick<BrowserUiState, "sidebar" | "overlay" | "dark">> = {}
): BrowserUiState {
  return {
    dark: true,
    overlay: null,
    preferences: { ...DEFAULT_PREFERENCES, ...preferences },
    sidebar: { dragging: false, focused: false, hovered: false },
    ...state,
  };
}

const revealStates = [
  {
    name: "hover",
    state: { sidebar: { dragging: false, focused: false, hovered: true } },
  },
  {
    name: "keyboard focus",
    state: { sidebar: { dragging: false, focused: true, hovered: false } },
  },
  {
    name: "drag",
    state: { sidebar: { dragging: true, focused: false, hovered: false } },
  },
  { name: "browser menu", state: { overlay: { kind: "menu" as const } } },
  {
    name: "context menu",
    state: {
      overlay: {
        kind: "tab-menu" as const,
        tabId: "synthetic-tab",
        x: 900,
        y: 500,
      },
    },
  },
] satisfies { name: string; state: Parameters<typeof ui>[1] }[];

describe("browser preferences", () => {
  it("accepts inclusive sidebar-width limits and rejects dimensions unsafe for native geometry", () => {
    for (const width of [200, 230, 420])
      assert.equal(preferencesSchema.parse({ width }).width, width);
    for (const width of [
      0,
      199,
      421,
      230.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "230",
      null,
    ]) {
      assert.equal(
        preferencesSchema.safeParse({ width }).success,
        false,
        `width ${String(width)}`
      );
    }
  });

  it("fills omitted preferences while retaining explicit false values", () => {
    const parsed = preferencesSchema.parse({
      bookmarksBar: false,
      newTabAtTop: false,
      side: "right",
    });
    assert.equal(parsed.side, "right");
    assert.equal(parsed.width, DEFAULT_PREFERENCES.width);
    assert.equal(parsed.sidebarMode, DEFAULT_PREFERENCES.sidebarMode);
    assert.equal(parsed.bookmarksBar, false);
    assert.equal(parsed.newTabAtTop, false);
  });

  it("rejects unsupported persisted enum values", () => {
    for (const patch of [
      { side: "top" },
      { sidebarMode: "hidden" },
      { theme: "sepia" },
      { searchEngine: "unsupported" },
    ]) {
      assert.equal(preferencesSchema.safeParse(patch).success, false);
    }
  });
});

describe("sidebar reveal lifecycle", () => {
  it("floating address entry does not independently reveal compact chrome", () => {
    for (const kind of ["address", "new-tab"] as const) {
      assert.equal(
        sidebarRevealed(ui({ sidebarMode: "compact" }, { overlay: { kind } })),
        false
      );
      assert.equal(
        sidebarRevealed(
          ui(
            { sidebarMode: "compact" },
            {
              overlay: { kind },
              sidebar: { dragging: false, focused: false, hovered: true },
            }
          )
        ),
        true
      );
    }
  });
  it("keeps expanded mode revealed without an interaction", () => {
    assert.equal(sidebarRevealed(ui({ sidebarMode: "expanded" })), true);
  });

  for (const mode of ["collapsed", "compact"] as const) {
    it(`${mode} hides only after every reveal reason clears`, () => {
      assert.equal(sidebarRevealed(ui({ sidebarMode: mode })), false);
      for (const { name, state } of revealStates) {
        assert.equal(
          sidebarRevealed(ui({ sidebarMode: mode }, state)),
          true,
          name
        );
      }
      const held = ui(
        { sidebarMode: mode },
        {
          overlay: { kind: "menu" },
          sidebar: { dragging: false, focused: true, hovered: false },
        }
      );
      held.overlay = null;
      assert.equal(
        sidebarRevealed(held),
        true,
        "closing a menu must not clear keyboard focus"
      );
      held.sidebar.focused = false;
      assert.equal(sidebarRevealed(held), false);
    });
  }
});

describe("browser content bounds", () => {
  for (const side of ["left", "right"] as const) {
    it(`reserves a docked expanded sidebar on the ${side}`, () => {
      const layout = browserLayout(
        1200,
        800,
        ui({ side, sidebarMode: "expanded", width: 230 })
      );
      assert.deepEqual(layout.content, {
        height: 784,
        width: 946,
        x: side === "left" ? 246 : 8,
        y: 8,
      });
      assert.deepEqual(layout.sidebar, {
        height: 800,
        width: 246,
        x: side === "left" ? 0 : 954,
        y: 0,
      });
      const gap =
        side === "left"
          ? layout.content.x - (layout.sidebar.x + layout.sidebar.width)
          : layout.sidebar.x - (layout.content.x + layout.content.width);
      assert.equal(
        gap,
        0,
        "the docked native surfaces must not overlap or leave an input gap"
      );
    });

    it(`reserves only a 60px collapsed rail and gutter on the ${side}`, () => {
      const layout = browserLayout(
        1200,
        800,
        ui({ side, sidebarMode: "collapsed" })
      );
      assert.deepEqual(layout.content, {
        height: 784,
        width: 1116,
        x: side === "left" ? 76 : 8,
        y: 8,
      });
      assert.deepEqual(layout.sidebar, {
        height: 800,
        width: 76,
        x: side === "left" ? 0 : 1124,
        y: 0,
      });
    });

    it(`keeps only the reveal strip in hidden compact mode on the ${side}`, () => {
      const layout = browserLayout(
        1200,
        800,
        ui({ side, sidebarMode: "compact" })
      );
      assert.deepEqual(layout.content, {
        height: 784,
        width: 1184,
        x: 8,
        y: 8,
      });
      assert.deepEqual(layout.sidebar, {
        height: 800,
        width: 8,
        x: side === "left" ? 0 : 1192,
        y: 0,
      });
    });

    for (const mode of ["expanded", "collapsed", "compact"] as const) {
      it(`${side} ${mode} hover, focus, drag, and overlays never reflow the page`, () => {
        const preferences = { side, sidebarMode: mode, width: 320 };
        const resting = browserLayout(1200, 800, ui(preferences));
        for (const { name, state } of revealStates) {
          const revealed = browserLayout(1200, 800, ui(preferences, state));
          assert.deepEqual(revealed.content, resting.content, name);
          assert.equal(revealed.sidebar.width, 336, name);
          if (side === "right")
            assert.equal(
              revealed.sidebar.x + revealed.sidebar.width,
              1200,
              name
            );
          else assert.equal(revealed.sidebar.x, 0, name);
        }
        assert.deepEqual(
          browserLayout(1200, 800, ui(preferences)),
          resting,
          "closing restores the resting rectangle"
        );
      });
    }

    it(`changing ${side} sidebar width reserves content only while docked`, () => {
      for (const mode of ["expanded", "collapsed", "compact"] as const) {
        const narrow = browserLayout(
          1200,
          800,
          ui({ side, sidebarMode: mode, width: 200 })
        );
        const wide = browserLayout(
          1200,
          800,
          ui({ side, sidebarMode: mode, width: 420 })
        );
        if (mode === "expanded") {
          assert.equal(narrow.content.width - wide.content.width, 220);
          assert.equal(
            wide.content.x - narrow.content.x,
            side === "left" ? 220 : 0
          );
        } else assert.deepEqual(wide.content, narrow.content);
      }
    });
  }

  it("clamps content extents for an empty or too-small viewport", () => {
    for (const mode of ["expanded", "collapsed", "compact"] as const) {
      for (const side of ["left", "right"] as const) {
        for (const [width, height] of [
          [0, 0],
          [8, 8],
          [16, 16],
          [60, 40],
        ]) {
          const { content, sidebar } = browserLayout(
            width!,
            height!,
            ui({ side, sidebarMode: mode })
          );
          assert.ok(content.width >= 0 && content.height >= 0);
          assert.ok(sidebar.x >= 0 && sidebar.width >= 0);
        }
      }
    }
  });

  it("reserves the bookmarks row without changing horizontal bounds or overlay reflow behavior", () => {
    for (const side of ["left", "right"] as const) {
      for (const sidebarMode of ["expanded", "collapsed", "compact"] as const) {
        const without = browserLayout(
          1200,
          800,
          ui({ bookmarksBar: false, side, sidebarMode })
        );
        const withBar = browserLayout(
          1200,
          800,
          ui({ bookmarksBar: true, side, sidebarMode })
        );
        assert.deepEqual(withBar.sidebar, without.sidebar);
        assert.equal(withBar.content.x, without.content.x);
        assert.equal(withBar.content.width, without.content.width);
        assert.equal(withBar.content.y, without.content.y + 30);
        assert.equal(withBar.content.height, without.content.height - 30);
        assert.equal(withBar.content.y + withBar.content.height, 792);
        for (const { name, state } of revealStates) {
          assert.deepEqual(
            browserLayout(
              1200,
              800,
              ui({ bookmarksBar: true, side, sidebarMode }, state)
            ).content,
            withBar.content,
            `${side} ${sidebarMode}: ${name}`
          );
        }
      }
    }
  });

  it("does not mutate preferences or interaction state while calculating geometry", () => {
    const state = ui(
      { side: "right", sidebarMode: "compact" },
      { overlay: { kind: "downloads" } }
    );
    const before = structuredClone(state);
    Object.freeze(state.preferences);
    Object.freeze(state.sidebar);
    Object.freeze(state.overlay);
    Object.freeze(state);
    browserLayout(1440, 900, state);
    sidebarRevealed(state);
    assert.deepEqual(state, before);
  });
});

describe("glance geometry", () => {
  it("uses Zen's 80%-wide, full-height card with external action buttons", () => {
    assert.deepEqual(glanceLayout(1200, 800), {
      frame: { height: 784, width: 960, x: 120, y: 8 },
      page: { height: 784, width: 960, x: 120, y: 8 },
    });
  });

  it("keeps the source width proportion and window gutters on a large window", () => {
    const { frame, page } = glanceLayout(2400, 1600);
    assert.equal(frame.width, 1920);
    assert.equal(frame.x, 240);
    assert.equal(frame.y, 8);
    assert.deepEqual(page, frame);
  });

  it("rounds odd viewports to integer bounds without drifting more than a pixel off center", () => {
    for (const [width, height] of [
      [801, 561],
      [1023, 777],
      [1441, 901],
    ]) {
      const { frame, page } = glanceLayout(width!, height!);
      for (const rect of [frame, page]) {
        assert.ok(Object.values(rect).every(Number.isInteger));
        assert.ok(rect.width >= 0 && rect.height >= 0);
      }
      assert.ok(Math.abs(frame.x - (width! - frame.x - frame.width)) <= 1);
      assert.ok(Math.abs(frame.y - (height! - frame.y - frame.height)) <= 1);
      assert.ok(page.x >= frame.x && page.y >= frame.y);
      assert.ok(page.x + page.width <= frame.x + frame.width);
      assert.ok(page.y + page.height <= frame.y + frame.height);
    }
  });

  for (const [width, height] of [
    [0, 0],
    [16, 40],
    [1200, 40],
  ]) {
    it(`never supplies negative native page extents for a ${width}×${height} viewport`, () => {
      const { page } = glanceLayout(width!, height!);
      assert.ok(page.width >= 0, `negative width ${page.width}`);
      assert.ok(page.height >= 0, `negative height ${page.height}`);
    });
  }
});
