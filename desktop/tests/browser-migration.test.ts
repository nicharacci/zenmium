import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyPreferences } from "../src/shared/browser-ui.ts";

test("absent legacy preferences never overwrite new defaults", () => {
  assert.deepEqual(legacyPreferences({}), {});
  assert.deepEqual(
    legacyPreferences({ compact: null, expanded: null, width: null }),
    {}
  );
});
test("legacy compact wins over expanded; explicit false values survive", () => {
  assert.deepEqual(
    legacyPreferences({
      compact: "true",
      expanded: "false",
      newTabTop: "false",
      side: "right",
      width: "310",
    }),
    { newTabAtTop: false, side: "right", sidebarMode: "compact", width: 310 }
  );
  assert.deepEqual(legacyPreferences({ compact: "false", expanded: "false" }), {
    sidebarMode: "collapsed",
  });
});
test("legacy width is clamped to supported geometry and malformed values are ignored", () => {
  assert.deepEqual(legacyPreferences({ width: "180" }), { width: 200 });
  for (const width of ["", "NaN", "421", "-1"])
    assert.deepEqual(legacyPreferences({ width }), {});
});
