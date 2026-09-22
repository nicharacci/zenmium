# internal/ — Zenmium internal products

The control plane for Zenmium's internal-products layer on the Helium
base. Ports the Electron browser-control contract v1
(`BROWSER_CONTROL_VERSION = 1`) and the agent rail (single OpenCode
loop) out of the Electron shell. See `CONTROL-CONTRACT.md` for the
normative contract and parity tables.

## Layout

| path | what it is |
|---|---|
| `control/` | contract core: error codes (28), types, redaction, grant/session store, the service itself |
| `relay/` | native-messaging host (`zenmium-control-host`) + unix-socket protocol (`ctl.*`, `ext.*` envelopes) |
| `bridge/` | loopback MCP bridge: `http://127.0.0.1:<port>/mcp`, bearer-gated, Origin/Host checks |
| `agent/` | OpenCode kernel spawn/monitor/SSE pump + chat manager (single loop, deny-list tools) |
| `secstore/` | AES-256-GCM persistence; data key in macOS Keychain (replaces Electron safeStorage) |
| `cmd/zenmiumd` | the persistent control daemon |
| `cmd/zenmium-control-host` | the per-connection native-messaging relay |
| `cmd/zenmiumctl` | CLI: install manifests, pair, grants, takeover/resume |
| `manifests/` | native-messaging host manifest templates (`io.zenmium.control.json`) |
| `policy/` | `recommended.policy.json` — RemoteDebuggingAllowed=false, ExtensionSettings |
| `config/endpoints.json` | T4-staged endpoint names for control-plane wiring |
| `scripts/pair-smoke.sh` | paired-client smoke: pair → session → observe → navigate → events |
| `docs/` | `WORKSPACE-MAP.md`, `ONEPASSWORD-LANE.md` |

Browser-side half lives in `browser/resources/zenmium/internal/`
(component extension: executor, service worker, pairing consent, agent
dock) and lands in the Chromium tree via
`browser/patches/zenmium/internal-component-extension.patch` +
`resources/helium_resources.txt`.

## Build & test

```sh
cd internal
go build ./... && go vet ./... && go test ./control/
```

## Install (dev)

```sh
zenmiumctl install   # writes io.zenmium.control.json into
                     # ~/Library/Application Support/Chromium/NativeMessagingHosts
                     # (Helium scans the stock Chromium NM dirs)
```

## Smoke

```sh
internal/scripts/pair-smoke.sh /path/to/zenmiumd
# simulated extension + real daemon + real MCP bridge:
# pair → token → capabilities → createSession → observe → navigate → events
# plus 403-Origin and 401-bearer guard checks
```

## Boundaries (non-negotiable)

- No raw global debugging endpoint; `cdp` is an adapter (Page.navigate,
  cdp.target only).
- Credentials never enter commands, observations, chat, or artifacts
  (1Password lane: extension + signed native connection).
- Native messaging fails closed; pairing requires in-browser consent;
  grant tokens hashed at rest, TTL ≤ 8h.
- One chat engine: the dock renders the daemon's OpenCode stream.
