# WORKSPACE-MAP.md — Electron Space → Chromium profile/workspace mapping

How the Electron app's "Space" concept maps onto the Helium base, and
which parts do not port.

## The binding

| Electron | Helium/Zenmium |
|---|---|
| Space (`desktop/src/main/workspace-sessions.ts`) | Chromium profile |
| Session-keyed WebContents set per space | `sessionTabs` set in the extension service worker, per profile |
| workspaceId minted in main process | `ws_<id>` minted by `zenmiumd`, bound to the profile via a nonce |
| IPC main↔renderer per space | native-messaging channel per profile (≤16 conns) |

**Workspace↔profile nonce.** Each component-extension instance
(profile-scoped) generates a UUID nonce on first run and stores it in
`chrome.storage.local` — a per-profile store invisible to other
profiles. On connect it presents the nonce to `zenmiumd`, which maps
nonce → `ws_<id>` in its `pairNonces` table. A different profile
generates a different nonce, so a workspace ID cannot be forged across
profiles: `WORKSPACE_NOT_FOUND` is returned if a client names a
workspace the pairing profile didn't originate.

## What maps

- One browsing scope per profile == one workspace. The extension
  service worker is per-profile, so session scope (tab sets, refs,
  watchers) is naturally profile-local — same invariant the Electron
  build enforced by partitioning `WebContents` per space.
- Session `control_<uuid>` objects live in the daemon keyed by
  (grant, workspace), exactly as they were keyed by (grant, space).
- `profile-state.ts` conversation/agent state becomes `secstore`
  records keyed by `ws_<id>`.

## What does NOT port (candidate list)

| Electron construct | why dropped |
|---|---|
| Multiple spaces inside one window/profile | Chromium has no sub-profile tab partition; use separate profiles. The one-tab-per-session policy is enforced regardless. |
| `profile-state.ts` in-memory + safeStorage hybrid | collapses into `secstore` (AES-GCM, Keychain-held data key) — one store, same durability, no plaintext path |
| Space-switch UI | T2 owns chrome UI; workspaces appear here only as opaque `ws_` ids to control clients |
| Space-level downloaded-file dir | `downloads.download` honors Chrome's download dir per profile; no space-scoped override exists |

## Notes for T4/control-plane consumers

- Endpoint names are staged in `internal/config/endpoints.json`
  (T4's `zenmium-services.fly.dev`, `zenmium-updates.fly.dev`,
  `zenmium-svc-crash.fly.dev`).
- Control-plane messages that reference a workspace should carry the
  `ws_<id>` string only — never a profile path, profile name, or any
  user-identifying directory name.
