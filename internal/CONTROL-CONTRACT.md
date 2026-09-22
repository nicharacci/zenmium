# CONTROL-CONTRACT.md — browser control contract v1

`BROWSER_CONTROL_VERSION = 1`. This document defines the internal
browser-control contract carried over from the Electron reference
implementation (`desktop/src/{shared,main}/browser-control*.ts`,
`native-messaging.ts`, `authentication-broker.ts`) onto the Helium base.
The Go daemon in `internal/` is the conformance point; this file is the
written parity map.

## Architecture mapping (Electron → Helium)

| Electron | Helium/Zenmium |
|---|---|
| `browser-control` service in main process | `zenmiumd` persistent daemon (`internal/`, Go) |
| `WebContents` driver (domControl script) | component extension executor `dom-control.js` in `third_party/zenmium_internal`, injected via `scripting.executeScript` (ISOLATED world) |
| Renderer IPC / service IPC | native messaging host `zenmium-control-host` (stdio ↔ unix-socket relay to `zenmiumd`) |
| `native-messaging.ts` host checks | Chromium native-messaging manifest verification + `zenmium-control-host` self-checks (realpath, perms, env scrub, ≤16 conns/profile) |
| safeStorage encrypted persistence | `internal/secstore` (AES-GCM, data key in macOS Keychain) |
| IPC verbs (`pair`, `createSession`, `execute`, …) | loopback MCP bridge `http://127.0.0.1:<port>/mcp` + `zenmiumctl` ctl-peer on the unix socket |
| Agent rail (OpenCode in renderer) | `internal/agent` kernel (`opencode serve` on 127.0.0.1, SSE pump, deny-list tools) + side-panel dock UI (`dock/`) |

## Command parity — 14 v1 commands

| v1 command | v1 capability | status | port notes |
|---|---|---|---|
| `observe` | observe | ported | DOM snapshot + refs via `dom-control.js`; sensitive-field and auth-page gates kept verbatim |
| `session.status` | — (meta) | ported | returns session state incl. controller, revision, watcher count |
| `navigate` | navigate | ported | `tabs.update` through driver; `needsObservation` gate applies |
| `click` | interact | ported | ref-based via executor; `documentId` staleness check |
| `fill` | interact | ported | executor `fill`; secret-free arguments only (see Boundaries) |
| `press` | interact | ported | executor `press` |
| `scroll` | interact | ported | executor `scroll` |
| `tab.close` | tabs | ported | one-tab policy enforced via sessionTabs set |
| `tab.create` | tabs | ported | `tabs.create`, adopted into session scope |
| `tab.adopt` | tabs | ported | existing tab adopted into session scope |
| `download` | downloads | ported | `downloads.download`; filename/title sanitized |
| `authenticate` | authenticate | ported | consent + broker statuses preserved; `authenticationRequired` observation suppression kept |
| `cdp` | cdp | adapted | `Page.navigate` only → mapped to `tabs.update`; anything else `CAPABILITY_DENIED` |
| `cdp.target` | cdp | adapted | `Target.info`-equivalent → `tabs.query` summary; no raw target attachment |

## Capability parity — v1 capability set

`observe navigate interact tabs downloads authenticate cdp` — all
present. `cdp` is intentionally narrower: the contract keeps the
capability *name* for client compatibility but restricts it to the two
adapter commands above. There is no general CDP attachment — see
Boundaries.

## Verb parity — control API surface

| v1 IPC verb | Helium transport | status |
|---|---|---|
| `pair` | `zenmiumctl pair` → ctl.peer on unix socket → `pair.request` → in-browser consent window → token returned once | ported |
| `revoke` | MCP `zenmium_session` {op: revoke} or `zenmiumctl revoke` | ported |
| `grants` | `zenmiumctl grants` (ctl.peer) | ported |
| `createSession` | MCP `zenmium_session` {op: create} | ported |
| `execute` | MCP `zenmium_action` | ported |
| `takeover` | `zenmiumctl takeover` (ctl.peer) | ported |
| `resume` | `zenmiumctl resume` (ctl.peer) | ported |
| `events` | MCP `zenmium_events` (poll; SSE over MCP is out of v1) | ported (poll) |
| `event` (wait-one) | `zenmium_events` {wait: true} | ported |
| `status` | MCP `zenmium_session` {op: status} | ported |

## Grant lifecycle parity

| property | v1 value | ported |
|---|---|---|
| token | `randomBytes(32).base64url` | yes — 256-bit, returned to the pairing caller exactly once |
| storage | SHA-256(token) only, `timingSafeEqual` compare | yes — daemon stores hashes, never plaintext |
| TTL | ≤ 8h, expiry sweep | yes — enforced + swept; default 1h, clamped 8h |
| sessions | `control_<uuid>` keyed by grant | yes |
| revision/fence | per-session monotonic revision + `STALE_REVISION` | yes |
| controller | `"agent" \| "human"` takeover tracking | yes |
| needsObservation gate | mutate → require fresh observation | yes |
| idempotency | `requestId` fingerprint journals, capped 10000 | yes |
| pairing | first-run in-browser consent, token once | yes — consent is a chrome-trusted surface (component-extension page); no plaintext pairing secret on disk |

## Error-code parity (28)

`UNAUTHORIZED WORKSPACE_NOT_FOUND TAB_OUT_OF_SCOPE SESSION_OUT_OF_SCOPE
CAPABILITY_DENIED REQUEST_CONFLICT REQUEST_LIMIT SESSION_BUSY
HUMAN_CONTROL STALE_REVISION OBSERVATION_REQUIRED ONE_TAB_POLICY
AUTHENTICATION_PROTECTED TARGET_UNAVAILABLE CONTROL_INTERRUPTED
TARGET_CHANGED STALE_OBSERVATION ORIGIN_MISMATCH
AUTH_PROVIDER_UNAVAILABLE REAUTHORIZE_SESSION ACTION_PENDING
ACTION_TIMEOUT INVALID_COMMAND NATIVE_ACTION_FAILED
JOURNAL_UNAVAILABLE DISPOSED INVALID_JSON INVALID_REQUEST BODY_TOO_LARGE
UNKNOWN_TOOL`

— all 28 defined in `internal/control/codes.go` and produced by
`service.go`/`bridge`. `ORIGIN_MISMATCH` and `AUTHENTICATION_PROTECTED`
are emitted by the authenticate + observe paths identically to v1.

## Event taxonomy parity

| event | v1 meaning | status |
|---|---|---|
| `navigated` | tab URL change in scope | ported |
| `observed` | observation taken | ported |
| `action.started` / `action.finished` | command lifecycle | ported |
| `control.changed` | controller agent↔human switch | ported |
| `grant.expired` / `grant.revoked` | grant lifecycle | ported |
| `session.disposed` | session end | ported |
| `auth.required` / `auth.finished` | authenticate flow | ported |

## MCP bridge parity

Loopback only (`http://127.0.0.1:<port>/mcp`), POST + `application/json`,
`Authorization: Bearer <token>`, rejects `Origin` header, non-loopback
remote, and wrong `Host`. JSON-RPC 2.0, `protocolVersion 2025-03-26`,
errors `-32600 -32601 -32602 -32603 -32700`. Tools:
`zenmium_capabilities`, `zenmium_session`, `zenmium_action`,
`zenmium_events`. Pairing is deliberately absent from the tool list —
consent-gated and reachable only via `zenmiumctl`.

## Authentication-broker parity

Statuses: `awaiting-consent awaiting-unlock filling awaiting-totp
needs-user authenticated cancelled denied expired failed unavailable` —
all preserved. Canonical HTTPS origin matching; `isProtectedTarget`
suppresses observation and input injection. Consent UI is the component
extension's chrome-trusted surface (pairing/consent pages), not a web
page.

## Agent rail parity

- Single OpenCode loop: `opencode serve --hostname 127.0.0.1 --port <free>`
  spawned by the daemon (`internal/agent/kernel.go`); random
  `OPENCODE_SERVER_PASSWORD` (32B) + `OPENCODE_SERVER_USERNAME=zenmium`,
  never logged.
- Health gate `/global/health` then `/app`; SSE `/event` reconnect loop;
  routes `/session`, `/session/{id}/message`, `/session/{id}/abort`,
  `/provider`, `/mcp`.
- Tool surface: `{"*": false}` deny-list + only `zenmium_*` tools enabled
  (the bridge tools above). No second chat engine — the dock renders the
  one conversation stream.
- System prompt: "You are Zenmium's browser assistant, not a coding
  agent…" kept verbatim.
- Model default `openrouter/deepseek/deepseek-v4.1-flash` overridable via
  `ZENMIUM_MODEL`; `OPENROUTER_API_KEY` referenced by name only.
- Chat manager: statuses `idle starting running stopped interrupted
  error`; requestId dedupe; parts→text normalization; `CHAT_LIMITS`
  (8 attachments ×10MB, 100k text, 24k pageText); persistence via
  `internal/secstore` replacing Electron safeStorage.
- Approval cards: OpenCode permission requests surface as dock approval
  cards (deny / once / always) — the tool-approval contract.

## Security boundaries (protected-zone laws)

1. **No raw global debugging endpoint.** `RemoteDebuggingAllowed=false`
   in `internal/policy/recommended.policy.json`; nothing in `internal/`
   or the extension binds or forwards a CDP socket. The `cdp` capability
   is the adapter above — full stop.
2. **No credential values in commands, observations, or artifacts.**
   `redactControlText` (bearer / sk_ / JWT / password-secret-token-otp
   / 6–19 digit runs) runs on every string that crosses the bridge;
   `safeControlUrl` strips userinfo/query/hash and folds ≥48-char path
   segments to `[redacted]`; executor sensitive-field + auth-page gates
   prevent capture at the source.
3. **Fail-closed native messaging.** Host name regex, manifest
   verification, realpath, executable but not group/world-writable,
   scrubbed env (PATH HOME TMPDIR LANG USER LOGNAME
   __CF_USER_TEXT_ENCODING), stderr drained, ≤16 connections per
   profile, 4-byte LE framing, 1MB cap, fatal UTF-8 — same rule set as
   `native-messaging.ts`, enforced partly by Chromium (manifest/
   extension-ID allowlist) and partly by `zenmium-control-host`
   self-checks at startup.
4. **No plaintext pairing secrets.** Tokens hashed at rest; the consent
   surface is the only issuance path; `zenmiumctl` writes any bridge
   file 0600.

## Electron IPC migration note

Clients that spoke `ipcRenderer.invoke('browser-control:...')` in the
Electron build now speak MCP over loopback (or `zenmiumctl` for
peer/control verbs). Request/response payloads are identical field-for-
field where the transport allows; `events` moved from push (IPC) to
poll (`zenmium_events {cursor, wait}`) because MCP over HTTP is
request-response — long-poll `wait:true` preserves the blocking-read
semantics without inventing a second channel.

## Deferred / not ported

| item | reason |
|---|---|
| `auth-compat.ts`, `onepassword-cli.ts` | files never existed in the checkout (dirty-tree artifacts on the control plane); the 1Password boundary is delivered via `docs/ONEPASSWORD-LANE.md` + policy instead |
| `store-install.ts`, `extension-host.ts` | out of T3 scope per brief |
| `events` push streaming | transport constraint; long-poll keeps semantics |
