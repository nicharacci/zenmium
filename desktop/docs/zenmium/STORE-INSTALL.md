# Zenmium extension store install

Status: implemented in `src/main/store-install.ts`, `src/main/extension-host.ts`,
`src/renderer/components/StoreInstall.tsx`. Proof rung for this seam is static + unit; it has not
yet been run against a live store or a packaged build.

This document describes the wrapped Chrome Web Store install flow end to end: what each stage
does, which Electron limitations it works around, how installs persist and reload, the security
checks, and what the feature deliberately does not do.

## Why a wrapper exists

Zenmium runs Chrome extensions on Electron's extension runtime. Electron does not implement
`chrome.webstorePrivate`, the private API the store's inline **Add to Chrome** button uses, and
there is no supported `.crx` loader. A normal store install therefore cannot complete inside the
app. Zenmium closes that gap by mirroring only the public download half of a store install:

1. resolve the same public update endpoint a browser uses,
2. download the CRX,
3. verify the package identity,
4. unpack it to disk,
5. load it as an unpacked extension.

The wrapper does **not** impersonate the store, does **not** claim the store installed anything,
and does **not** implement store account, rating, review, or update APIs. The code comment in
`store-install.ts` states this: the loader only mirrors the download process.

## End-to-end flow

```
operator input (id or detail URL)
        │
        ▼
[resolving]    parseExtensionId()             validate /^[a-p]{32}$/ or parse allowlisted URL
        │
        ▼
[downloading]  buildCrxUpdateUrl()            GET clients2.google.com/service/update2/crx
        │      undici request, redirects      stream bytes, report received/total/percent
        ▼
[verifying]    parseCrx()                     Cr24 magic, version, header bounds
        │      declared id + derived id       both must match the requested id
        ▼
[extracting]   assertSafeEntry() per entry    reject absolute paths, "..", null bytes
        │      adm-zip -> staging dir         then swap staging into place
        ▼
[installing]   ExtensionHost.load()           Electron loadExtension + registry persist
        │
        ▼
[done] or [error]
```

Progress is emitted on an injected `EventEmitter` under `STORE_INSTALL_PROGRESS_EVENT`
(`zenmium:store-install:progress`). Each payload is:

```ts
{
  stage: "resolving" | "downloading" | "verifying" | "extracting" | "installing" | "done" | "error",
  id: string | null,
  name: string | null,
  receivedBytes: number,
  totalBytes: number | null,
  percent: number | null,
  reason: string | null,
}
```

`start(idOrUrl)` resolves to a terminal result:

```ts
// success
{ ok: true, id, path, version, name }

// failure — stage names where it stopped, reason is a human sentence
{ ok: false, seam: "store-install", stage: "verifying", reason: "The package declares …" }
```

## Stage detail

### 1. Resolving — input parsing

`extensionIdSchema` validates the id shape: exactly 32 characters from `a` to `p`. The store
alphabet is `a-p` because an extension id is 16 bytes rendered as hex and then shifted so each
nibble `0-f` becomes `a-p`.

`parseExtensionId()` accepts:

- a bare id, e.g. `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
- `https://chromewebstore.google.com/detail/<slug>/<id>`;
- `https://chrome.google.com/webstore/detail/<slug>/<id>`;
- any of those URLs carrying `?id=<id>`.

Only `https` and the two allowlisted store hosts are accepted. The supplied URL is **parsed, never
fetched**; the request origin is hard-coded to `https://clients2.google.com`.

### 2. Downloading

`buildCrxUpdateUrl()` produces the public update URL:

```
https://clients2.google.com/service/update2/crx
  ?response=redirect
  &prodversion=<chromium version>
  &acceptformat=crx2,crx3
  &x=id%3D<id>%26uc
```

The Chromium version comes from `process.versions.chrome`, so the endpoint sees a plausible
client. `undici.request` follows up to 10 redirects. The response body is streamed and progress
is emitted at most every 100 ms with `receivedBytes`, `totalBytes` (from `Content-Length` when
present), and `percent` (null when the total is unknown). The download is capped at 256 MB.

### 3. Verifying

`parseCrx()` accepts CRX2 and CRX3 containers. For CRX3 it reads the `CrxFileHeader` protobuf
directly (no extra dependency) and extracts:

- the embedded public key from `sha256_with_rsa` / `sha256_with_ecdsa`;
- the `crx_id` from `signed_header_data` (`SignedData.crx_id`).

The extension id is derived from a public key by taking `SHA-256(publicKey)`, keeping the first
16 bytes, and mapping each hex nibble to `a-p`. The install proceeds only when every id that can
be read matches the requested id, and when the declared id and the derived id agree with each
other. If the header carries no id at all, the install fails closed.

### 4. Extracting

The zip payload is opened with `adm-zip`. Every entry is validated before extraction:

- no absolute paths (`/…` or `C:…`),
- no `..` path segments,
- no null bytes.

Files are extracted into a sibling staging directory and then swapped into
`userData/zenmium/extensions/<id>/`. If a previous install exists it is moved aside first and
restored if the swap fails. A package without `manifest.json` is rejected. `adm-zip` enforces the
per-entry CRC while reading.

### 5. Installing

The directory is handed to `ExtensionHost.load()`, which calls
`session.defaultSession.extensions.loadExtension(path, { allowFileAccess: true })`, records the
canonical id/name/version Electron reports, persists the registry row, and emits extension
progress.

## Persistence and boot reload

Electron does **not** persist loaded extensions across restarts, and there is no auto-update from
the store. Zenmium keeps its own registry at:

```
app.getPath("userData")/zenmium/extensions.json
```

Shape:

```json
{
  "version": 1,
  "extensions": {
    "<id>": {
      "id": "<id>",
      "path": "/…/zenmium/extensions/<id>",
      "version": "1.2.3",
      "enabled": true,
      "name": "Example"
    }
  }
}
```

Writes are atomic: a temp file in the same directory is written, then renamed over the target. A
corrupt registry is renamed to `extensions.json.corrupt-<timestamp>` rather than deleted.

On boot, after `app.whenReady()`, call `ExtensionHost.boot()`. It reads the registry and reloads
every row with `enabled: true`. Failures are returned per-id and never thrown, so one bad
extension cannot block the rest. `setEnabled(id, false)` unloads the extension but keeps the row,
so it stays disabled on the next boot.

## Electron limitations worked around (and not worked around)

| Limitation | Status | What Zenmium does |
| --- | --- | --- |
| No `.crx` loader | Worked around | Unpacks the CRX to a managed directory and loads it unpacked. |
| Loaded extensions are per-process | Worked around | Own registry + `boot()` reload. |
| `chrome.webstorePrivate` missing | Worked around | Wrapped install instead of the store button. |
| `nativeMessaging` missing | Not worked around | Fail closed; do not advertise native messaging. |
| `declarativeNetRequest` missing | Not worked around | Fail closed; do not advertise DNR blocking. |
| `storage.sync` missing | Not worked around | `storage.local` only; never say "syncs across devices". |
| MV3 background service worker unsupported | Not worked around | An MV3 extension may load but its worker will not run. |
| No store auto-update | Not worked around | Extensions change only on a Zenmium install or reload. |
| Widevine / DRM removed | Not worked around | Documented as unsupported; fail gracefully. |

These are recorded in the header comment of `extension-host.ts` and tracked as `ZEN-001`…`ZEN-007`
in `ISSUES.md`.

## Security checks

- **Id validation before network.** The id must match `[a-p]{32}` before any request is made.
- **Origin.** The supplied URL is only parsed, and only from `chromewebstore.google.com` or
  `chrome.google.com`. The fetch origin is hard-coded; the user cannot redirect the download.
- **Package identity.** The CRX header's declared `crx_id` and the id derived from the embedded
  public key must both equal the requested id. This is the `ZEN-004` check against an
  attacker-controlled fallback package installed under the wrong id.
- **Zip safety.** Absolute paths, `..`, and null bytes are rejected before extraction. `adm-zip`
  enforces entry CRCs.
- **Atomic install.** Staging + swap + rollback so a failed install cannot leave a half-written
  extension directory.
- **Bounded download.** 256 MB cap and request timeouts.
- **No secret exposure.** The installer touches no keys. The agent kernel reads
  `OPENROUTER_API_KEY` by name only and redacts any diagnostics.

## What this deliberately does not do

- **No store impersonation.** Zenmium is not the store and does not present itself as one.
- **No credit or attribution.** The UI and docs do not claim the store installed the extension.
- **No signature-chain verification.** v1 does not pin a Google root, so it cannot claim
  cryptographic provenance. It verifies structural integrity and id agreement, and the UI must
  not claim more. This is an open item for a later hardening pass.
- **No auto-update from the store.** There is no polling of the update endpoint.
- **No account, rating, review, or payment APIs.**
- **No `.crx` files written to disk.** Only the unpacked payload is persisted.
- **No install without `manifest.json`.**

## Integration seams

- `ExtensionHost` owns the registry and the Electron load/unload lifecycle.
- `StoreInstaller` owns the network + CRX pipeline and calls `ExtensionHost.load`.
- `StoreInstall.tsx` is presentation only; it receives `install` and `subscribe` from the base
  renderer and never imports Electron at runtime.
- IPC channel names are exported as `EXTENSION_IPC`, `STORE_INSTALL_IPC`, and `AGENT_IPC` so the
  base lane can re-export them from `src/shared/ipc.ts`. The base lane owns the preload bridge.

## Rollback

Revert the four files in this seam. Installed extensions under
`userData/zenmium/extensions/` are product-owned data and are not deleted by a revert; remove an
extension through `ExtensionHost.remove(id)` or by deleting its row from the registry.
