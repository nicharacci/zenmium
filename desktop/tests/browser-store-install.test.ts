import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HELPER_ID = "ocaahdebbfolfmndjeplogmgcagdmblk";

test("the bundled Web Store helper has a pinned package identity", () => {
  assert.match(HELPER_ID, /^[a-p]{32}$/);
  assert.match(
    `https://clients2.google.com/service/update2/crx?response=redirect&x=id%3D${HELPER_ID}%26uc`,
    /^https:\/\/clients2\.google\.com\/service\/update2\/crx\?/,
  );
});

test("the pinned Web Store helper package is retained byte-for-byte", () => {
  const packagePath = fileURLToPath(new URL("../resources/chromium-web-store/Chromium Web Store.crx", import.meta.url));
  const bytes = readFileSync(packagePath);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "Cr24");
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "63c075b4a25b11af2c536dad191946e8d9547f92d5b6c257b2ce4138d2996f32",
  );
});
