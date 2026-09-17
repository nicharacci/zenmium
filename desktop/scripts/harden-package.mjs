import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  flipFuses,
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
} from "@electron/fuses";

// Apply to the packaged binary only, before electron-builder signs it. Never
// mutate the developer's Electron runtime or an already-installed application.
export const requiredFuses = Object.freeze({
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
});

export async function verifyPackagedFuses(bundle) {
  const wire = await getCurrentFuseWire(bundle);
  assert.equal(wire.version, FuseVersion.V1, "Unsupported packaged fuse version");
  for (const [option, enabled] of Object.entries(requiredFuses)) {
    assert.equal(
      wire[option],
      enabled ? FuseState.ENABLE : FuseState.DISABLE,
      `Unsafe packaged fuse: ${FuseV1Options[option]}`,
    );
  }
  return Object.fromEntries(
    Object.entries(requiredFuses).map(([option, enabled]) => [
      FuseV1Options[option],
      enabled,
    ]),
  );
}

export default async function hardenPackage(context) {
  assert.ok(
    context.electronPlatformName === "darwin" || context.electronPlatformName === "win32",
    "Only macOS and Windows releases are configured",
  );
  const name = context.packager.appInfo.productFilename;
  assert.equal(name, "Zenmium", "Refusing to harden a non-Zenmium bundle");
  const isMac = context.electronPlatformName === "darwin";
  const bundle = isMac ? join(context.appOutDir, `${name}.app`) : context.appOutDir;
  const executable = isMac ? bundle : join(bundle, `${name}.exe`);
  const asar = isMac
    ? join(bundle, "Contents", "Resources", "app.asar")
    : join(bundle, "resources", "app.asar");
  await access(asar);
  await flipFuses(executable, {
    version: FuseVersion.V1,
    ...requiredFuses,
    // electron-builder signs the packaged bundle after this hook. Do not reset
    // or weaken the signature on an existing user installation.
    ...(isMac ? { resetAdHocDarwinSignature: false } : {}),
  });
  await verifyPackagedFuses(executable);
  console.log(`Verified packaged Zenmium security fuses before ${isMac ? "signing" : "Windows packaging"}.`);
}
