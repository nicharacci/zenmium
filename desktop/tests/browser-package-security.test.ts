import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FuseV1Options } from "@electron/fuses";
import hardenPackage, { requiredFuses } from "../scripts/harden-package.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("release fuse policy disables ambient Node entrypoints and protects ASAR/cookies", () => {
  assert.equal(requiredFuses[FuseV1Options.RunAsNode], false);
  assert.equal(requiredFuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable], false);
  assert.equal(requiredFuses[FuseV1Options.EnableNodeCliInspectArguments], false);
  assert.equal(requiredFuses[FuseV1Options.EnableCookieEncryption], true);
  assert.equal(requiredFuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], true);
  assert.equal(requiredFuses[FuseV1Options.OnlyLoadAppFromAsar], true);
  assert.equal(Object.isFrozen(requiredFuses), true);
});

test("hardening refuses an unrelated bundle before touching a binary", async () => {
  await assert.rejects(hardenPackage({ electronPlatformName: "linux" }), /Only macOS/);
  await assert.rejects(hardenPackage({
    electronPlatformName: "darwin",
    packager: { appInfo: { productFilename: "Electron" } },
  }), /non-Zenmium/);
});

test("secret scan rejects synthetic credentials without echoing their value", () => {
  const out = join(desktop, "out");
  mkdirSync(out, { recursive: true });
  const fixture = mkdtempSync(join(out, "secret-scan-test-"));
  // Synthetic detector fixture, constructed at runtime. This is not a credential.
  const synthetic = ["ghp", "_", "a1B2c3D4".repeat(4), "E5f6"].join("");
  try {
    writeFileSync(join(fixture, "fixture.txt"), `token=${synthetic}\n`, { mode: 0o600 });
    const run = spawnSync(process.execPath, [join(desktop, "scripts/scan-secrets.mjs"), fixture], {
      cwd: desktop,
      encoding: "utf8",
    });
    const output = `${run.stdout}${run.stderr}`;
    assert.equal(output.includes(synthetic), false, "Scanner must never print the matched value");
    assert.equal(run.status, 1);
    assert.match(output, /secretlint-rule-github/);
    assert.match(output, /1 findings/);
  } finally {
    // This exact generated directory contains only the synthetic test fixture.
    rmSync(fixture, { recursive: true });
  }
});

test("secret scan refuses an empty input rather than reporting a false success", () => {
  const out = join(desktop, "out");
  mkdirSync(out, { recursive: true });
  const fixture = mkdtempSync(join(out, "secret-scan-empty-"));
  try {
    const run = spawnSync(process.execPath, [join(desktop, "scripts/scan-secrets.mjs"), fixture], {
      cwd: desktop,
      encoding: "utf8",
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /no text inputs/);
  } finally {
    rmSync(fixture, { recursive: true });
  }
});
