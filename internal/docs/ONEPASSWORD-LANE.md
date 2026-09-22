# ONEPASSWORD-LANE.md — 1Password credential lane

The credential boundary for Zenmium: 1Password is the only
credential-store integration. No credential values ever cross the
control contract — not in commands, observations, chat, logs, or
artifacts.

## The lane

1. **Extension** — the official 1Password browser extension
   (`aeblfdkhhhdcdjpifhhbdiojplfjncoa`) is allowed by policy
   (`internal/policy/recommended.policy.json` → `ExtensionSettings`)
   and installed by user choice. It talks the normal extension
   autofill APIs inside the page world.
2. **Native connection** — the extension reaches the 1Password app via
   Chrome native messaging, host name `com.1password.1password`,
   pointing at
   `/Applications/1Password.app/Contents/MacOS/1Password-BrowserSupport`.
   Helium already scans the stock Chromium `NativeMessagingHosts`
   directories (`scan-chrome-native-messaging-hosts.patch`), so the
   stock manifest location works.
3. **Signed + verified** — 1Password's own native host is codesigned;
   Chrome's native-messaging machinery verifies the manifest, host
   path, and extension ID allowlist before spawning it. Zenmium adds
   no bypass: `internal/manifests/com.1password.1password.allowed.json`
   is the reference manifest — the real one is installed by 1Password,
   not by Zenmium.

## Policy shape

```jsonc
// internal/policy/recommended.policy.json (excerpt)
"ExtensionSettings": {
  "koaiegnjnlbfgibjpjdcbnjejnihgfoa": {
    "installation_mode": "force_installed"   // zenmium_internal
  },
  "aeblfdkhhhdcdjpifhhbdiojplfjncoa": {
    "installation_mode": "allowed",          // 1Password — user choice
    "update_url": "https://clients2.google.com/service/update2/crx"
  }
}
```

Profiles that should not have a credential lane set the 1Password entry
to `"blocked"` instead — the same policy object covers both.

## What the agent rail may do

- The `authenticate` contract command hands control to the broker,
  which surfaces the extension's own UI (consent + unlock) — the
  extension+native-host lane performs the fill.
- `AUTH_PROVIDER_UNAVAILABLE` is returned if the extension or its
  native host is absent/locked; `REAUTHORIZE_SESSION` if the vault
  locks mid-flow.

## What the agent rail must never do

- **No `op` CLI lane.** `onepassword-cli.ts` was dropped in the port
  (it never existed in the reference checkout). The `OP_SERVICE_ACCOUNT_TOKEN`
  lane in `docs/zenmium/SECRETS.md` is for CI/agent automation against
  the secrets service, not for in-browser credential fill.
- **No secret material in the control plane.** DOM observations exclude
  sensitive fields and suppress capture on auth pages; `redactControlText`
  runs on anything that still leaks.
- **No native-messaging bypass.** The 1Password host connection is
  mediated by Chrome's own verification, not by `zenmium-control-host`.
  Our host manifest (`io.zenmium.control.json`) is a separate channel
  and carries control envelopes only — never credential payloads.
- **No Keychain credential reads by the agent.** `internal/secstore`
  uses the Keychain only for its own AES data key (Zenmium service,
  application password); it does not read 1Password items.

## Keychain storage path (replaces Electron safeStorage)

| Electron | Zenmium |
|---|---|
| `safeStorage.encryptString` blobs on disk | AES-256-GCM `secstore` file; random 32B data key |
| key material managed by macOS Keychain via Electron | data key stored as a Keychain **generic-password item** — service `io.zenmium.secstore`, account `data-key`, created on first daemon run |

The Keychain item is application-scoped to the daemon; nothing else
reads it. Deleting the item irrecoverably orphans persisted chat/
session state — equivalent to clearing safeStorage in the Electron
build.

## Failure modes (all fail closed)

| condition | result |
|---|---|
| 1Password app locked/absent | `AUTH_PROVIDER_UNAVAILABLE` |
| extension uninstalled mid-flow | broker → `unavailable`, session keeps no credentials |
| native host handshake fails | Chrome kills the port; broker → `failed` |
| credential-shaped string hits the bridge | `redactControlText` → `[redacted]` |
