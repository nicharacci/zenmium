import assert from "node:assert/strict";
import test from "node:test";
import {
  openTabContextMenuFromKeyboard,
  type TabContextMenuKeyEvent,
  type TabContextMenuPayload,
} from "../src/shared/tab-context-menu.ts";

interface KeyEventLog {
  preventDefaultCalls: number;
  stopPropagationCalls: number;
}

interface KeyEventInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

function makeKeyEvent(input: KeyEventInput): {
  event: TabContextMenuKeyEvent;
  log: KeyEventLog;
} {
  const log: KeyEventLog = { preventDefaultCalls: 0, stopPropagationCalls: 0 };
  const event = {
    key: input.key,
    shiftKey: input.shiftKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    altKey: input.altKey ?? false,
    metaKey: input.metaKey ?? false,
    nativeEvent: { isComposing: input.isComposing ?? false },
    preventDefault() {
      log.preventDefaultCalls += 1;
    },
    stopPropagation() {
      log.stopPropagationCalls += 1;
    },
  };
  return { event, log };
}

function makeTarget(bottom: number) {
  const counts = { rectReads: 0 };
  const target = {
    getBoundingClientRect() {
      counts.rectReads += 1;
      return { bottom };
    },
  };
  return { target, counts };
}

function makeTabId() {
  return { id: "tab-1" };
}

function runHandler(input: KeyEventInput, bottom: number) {
  const tabId = makeTabId();
  const { event, log } = makeKeyEvent(input);
  const { target, counts } = makeTarget(bottom);
  const calls: TabContextMenuPayload<typeof tabId>[] = [];
  const handled = openTabContextMenuFromKeyboard(
    event,
    target,
    tabId,
    (payload) => {
      calls.push(payload);
    },
  );
  return { handled, calls, counts, log, tabId };
}

test("ContextMenu key opens the tab menu like the pointer path", () => {
  const result = runHandler({ key: "ContextMenu" }, 214.5);
  assert.equal(result.handled, true);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0], {
    kind: "tab-menu",
    tabId: result.tabId,
    y: 214.5,
  });
  assert.equal(result.counts.rectReads, 1);
  assert.equal(result.log.preventDefaultCalls, 1);
  assert.equal(result.log.stopPropagationCalls, 1);
});

test("Shift+F10 opens the same menu payload as ContextMenu", () => {
  const result = runHandler({ key: "F10", shiftKey: true }, 88);
  assert.equal(result.handled, true);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0], {
    kind: "tab-menu",
    tabId: result.tabId,
    y: 88,
  });
  assert.equal(result.counts.rectReads, 1);
  assert.equal(result.log.preventDefaultCalls, 1);
  assert.equal(result.log.stopPropagationCalls, 1);
});

test("plain F10 without Shift is ignored", () => {
  const result = runHandler({ key: "F10" }, 50);
  assert.equal(result.handled, false);
  assert.equal(result.calls.length, 0);
  assert.equal(result.counts.rectReads, 0);
  assert.equal(result.log.preventDefaultCalls, 0);
  assert.equal(result.log.stopPropagationCalls, 0);
});

test("Shift+ContextMenu is not a recognized shortcut", () => {
  const result = runHandler({ key: "ContextMenu", shiftKey: true }, 50);
  assert.equal(result.handled, false);
  assert.equal(result.calls.length, 0);
  assert.equal(result.counts.rectReads, 0);
  assert.equal(result.log.preventDefaultCalls, 0);
  assert.equal(result.log.stopPropagationCalls, 0);
});

test("other keys are ignored", () => {
  for (const key of ["Enter", " ", "ArrowDown", "F2", "F4"]) {
    const result = runHandler({ key }, 50);
    assert.equal(result.handled, false, `expected key ${key} to be ignored`);
    assert.equal(result.calls.length, 0, `expected no open call for key ${key}`);
    assert.equal(result.counts.rectReads, 0, `expected no rect read for key ${key}`);
    assert.equal(
      result.log.preventDefaultCalls,
      0,
      `expected no preventDefault for key ${key}`,
    );
    assert.equal(
      result.log.stopPropagationCalls,
      0,
      `expected no stopPropagation for key ${key}`,
    );
  }
});

test("modifier combos are ignored", () => {
  const combos = [
    { key: "F10", shiftKey: true, ctrlKey: true },
    { key: "F10", shiftKey: true, altKey: true },
    { key: "F10", shiftKey: true, metaKey: true },
    { key: "ContextMenu", ctrlKey: true },
    { key: "ContextMenu", altKey: true },
    { key: "ContextMenu", metaKey: true },
  ];
  for (const combo of combos) {
    const result = runHandler(combo, 50);
    assert.equal(result.handled, false, `expected combo to be ignored`);
    assert.equal(result.calls.length, 0);
    assert.equal(result.counts.rectReads, 0);
    assert.equal(result.log.preventDefaultCalls, 0);
    assert.equal(result.log.stopPropagationCalls, 0);
  }
});

test("IME composing events are rejected even for recognized keys", () => {
  const contextMenuResult = runHandler(
    { key: "ContextMenu", isComposing: true },
    50,
  );
  assert.equal(contextMenuResult.handled, false);
  assert.equal(contextMenuResult.calls.length, 0);
  assert.equal(contextMenuResult.counts.rectReads, 0);
  assert.equal(contextMenuResult.log.preventDefaultCalls, 0);
  assert.equal(contextMenuResult.log.stopPropagationCalls, 0);
  const f10Result = runHandler(
    { key: "F10", shiftKey: true, isComposing: true },
    50,
  );
  assert.equal(f10Result.handled, false);
  assert.equal(f10Result.calls.length, 0);
  assert.equal(f10Result.counts.rectReads, 0);
  assert.equal(f10Result.log.preventDefaultCalls, 0);
  assert.equal(f10Result.log.stopPropagationCalls, 0);
});

test("unrecognized key does not touch callback or rect", () => {
  const counts = { rectReads: 0, callbackCalls: 0 };
  const { event } = makeKeyEvent({ key: "a" });
  const handled = openTabContextMenuFromKeyboard(
    event,
    {
      getBoundingClientRect() {
        counts.rectReads += 1;
        return { bottom: 1 };
      },
    },
    makeTabId(),
    () => {
      counts.callbackCalls += 1;
    },
  );
  assert.equal(handled, false);
  assert.equal(counts.rectReads, 0);
  assert.equal(counts.callbackCalls, 0);
});
