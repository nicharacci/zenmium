import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { emptyState, type Tab } from "../src/shared/ipc.ts";

// Resolve the production TypeScript alias to the real module. React and all
// other dependencies load normally; the pure helpers do not invoke hooks.
const aliases = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "@shared/ipc"
        ? new URL("../src/shared/ipc.ts", import.meta.url).href
        : specifier,
      context
    );
  },
});
const { canDropTab, isEssentialTab, moveSidebarTab } = await import(
  "../src/renderer/components/browser/SidebarDrag.ts"
);
aliases.deregister();

function tab(id: string, patch: Partial<Tab> = {}): Tab {
  return {
    folderId: null,
    id,
    kind: "today",
    lastActiveAt: 0,
    loading: false,
    spaceId: "personal",
    title: id,
    url: "https://example.com/",
    ...patch,
  };
}

function workspace(essentialCount: number, folderPinCount = 0) {
  return {
    ...emptyState(),
    tabs: [
      ...Array.from({ length: essentialCount }, (_, index) =>
        tab(`essential-${index}`, { kind: "pinned" })
      ),
      ...Array.from({ length: folderPinCount }, (_, index) =>
        tab(`folder-${index}`, { folderId: "research", kind: "pinned" })
      ),
    ],
  };
}

const essentialDestination = {
  folderId: null,
  kind: "pinned" as const,
  spaceId: "personal",
};

describe("sidebar drag capacity", () => {
  it("distinguishes essential tiles from ordinary and folder-pinned rows", () => {
    assert.equal(isEssentialTab(tab("ordinary")), false);
    assert.equal(isEssentialTab(tab("essential", { kind: "pinned" })), true);
    assert.equal(
      isEssentialTab(tab("folder", { folderId: "research", kind: "pinned" })),
      false
    );
  });

  it("permits the twelfth essential even with many folder pins", () => {
    assert.equal(
      canDropTab(workspace(11, 20), tab("new"), essentialDestination),
      true
    );
    assert.equal(
      canDropTab(workspace(12, 20), tab("new"), essentialDestination),
      false
    );
  });

  it("allows reordering an existing essential at capacity", () => {
    const source = tab("essential-0", { kind: "pinned" });
    assert.equal(canDropTab(workspace(12), source, essentialDestination), true);
  });

  it("requires a free slot when promoting a folder pin to an essential", () => {
    const source = tab("folder-0", { folderId: "research", kind: "pinned" });
    assert.equal(
      canDropTab(workspace(12, 1), source, essentialDestination),
      false
    );
    assert.equal(
      canDropTab(workspace(11, 1), source, essentialDestination),
      true
    );
  });

  it("allows folder drops and unpinning when all essential slots are occupied", () => {
    const state = workspace(12, 1);
    const source = tab("new");
    assert.equal(
      canDropTab(state, source, {
        ...essentialDestination,
        folderId: "research",
      }),
      true
    );
    assert.equal(
      canDropTab(state, tab("essential-0", { kind: "pinned" }), {
        ...essentialDestination,
        kind: "today",
      }),
      true
    );
  });

  it("counts only the destination workspace and still rejects a foreign essential at capacity", () => {
    const state = workspace(12);
    const source = tab("foreign", { kind: "pinned", spaceId: "work" });
    assert.equal(canDropTab(state, source, essentialDestination), false);
    assert.equal(
      canDropTab(state, tab("new"), {
        ...essentialDestination,
        spaceId: "work",
      }),
      true
    );
  });

  it("treats a folder pin dropped on another workspace as a new essential", () => {
    const source = tab("foreign-folder", {
      folderId: "work-folder",
      kind: "pinned",
      spaceId: "work",
    });
    assert.equal(
      canDropTab(workspace(12), source, { spaceId: "personal" }),
      false
    );
    assert.equal(
      canDropTab(workspace(11), source, { spaceId: "personal" }),
      true
    );
    assert.equal(
      canDropTab(workspace(12), source, {
        ...essentialDestination,
        folderId: "research",
      }),
      true
    );
  });

  it("retains implicit folder membership within the same workspace", () => {
    const source = tab("folder-0", { folderId: "research", kind: "pinned" });
    assert.equal(
      canDropTab(workspace(12, 1), source, { spaceId: "personal" }),
      true
    );
  });

  it("does not mutate the state, source tab, or destination", () => {
    const state = workspace(12, 1);
    const source = Object.freeze(tab("new"));
    const destination = Object.freeze({ ...essentialDestination });
    const before = structuredClone(state);
    for (const entry of state.tabs) {
      Object.freeze(entry);
    }
    Object.freeze(state.tabs);
    Object.freeze(state);
    assert.equal(canDropTab(state, source, destination), false);
    assert.deepEqual(state, before);
  });
});

describe("sidebar drag command ordering", () => {
  const recording = () => {
    const calls: [string, unknown][] = [];
    const invoke = async <T = unknown>(
      channel: string,
      payload?: unknown
    ): Promise<T> => {
      calls.push([channel, payload]);
      return undefined as T;
    };
    return { calls, invoke };
  };

  it("pins before reordering into essentials", async () => {
    const { calls, invoke } = recording();
    await moveSidebarTab(invoke, tab("source"), {
      ...essentialDestination,
      beforeId: "next",
    });
    assert.deepEqual(calls, [
      ["arc:pinTab", "source"],
      ["arc:reorderTab", { beforeId: "next", id: "source" }],
    ]);
  });

  it("moves a cross-workspace pin into a folder without consuming a root slot or losing its reset URL", async () => {
    const { calls, invoke } = recording();
    await moveSidebarTab(
      invoke,
      tab("source", {
        kind: "pinned",
        pinnedUrl: "https://example.com/original",
      }),
      {
        beforeId: null,
        folderId: "research",
        kind: "pinned",
        spaceId: "work",
      }
    );
    assert.deepEqual(calls, [
      ["arc:unpinTab", "source"],
      ["arc:moveTabToSpace", { id: "source", spaceId: "work" }],
      ["arc:moveToFolder", { folderId: "research", id: "source" }],
      [
        "arc:updateTab",
        {
          id: "source",
          patch: {
            pinnedChanged: true,
            pinnedUrl: "https://example.com/original",
          },
        },
      ],
      ["arc:reorderTab", { beforeId: null, id: "source" }],
    ]);
  });

  it("does not reorder after a rejected membership change", async () => {
    const calls: string[] = [];
    await assert.rejects(
      moveSidebarTab(
        async <T = unknown>(channel: string): Promise<T> => {
          calls.push(channel);
          throw new Error("Workspace no longer exists");
        },
        tab("source"),
        { beforeId: null, spaceId: "missing" }
      ),
      /no longer exists/
    );
    assert.deepEqual(calls, ["arc:moveTabToSpace"]);
  });
});
