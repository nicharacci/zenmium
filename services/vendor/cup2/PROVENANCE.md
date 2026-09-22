# Provenance: services/vendor/cup2

Vendored clone of **imputnet/cup2** for S005 / track T4.

| Field | Value |
| --- | --- |
| Upstream repo | https://github.com/imputnet/cup2 |
| Pinned ref | `main` @ `bee47000cd87` (no releases; main-branch pin) |
| Commit | `bee47000cd87162499ec58970113929b22c03bd7` |
| Commit date | 2025-04-13 |
| License | AGPL-3.0 (`LICENSE` retained) |
| Vendored | 2026-09-22 via `rsync -a --exclude='.git'`, byte-identical to the pinned commit |

## What it is

TypeScript implementation of the Chromium/Omaha **Client Update Protocol (CUP-ECDSA)**: the signature layer update servers use so the browser's `update_client` can verify that update responses came from us. Exports `CupServer` (`makeTicket` + `sign`) and `CupClient` (verify). JSR package: `@imput/cup2`.

It is a **library, not a runnable service**: upstream ships no server binary. The Solvys-side signing edge that hosts it lives at `services/deploy/fly/cup2/` (a thin Deno wrapper marked as Zenmium-owned glue, not an upstream edit).

## Where it sits in the endpoint map

- `services.helium.imput.net/com` + `/ext` (Omaha update queries) are served by `svc/extension-proxy`, which proxies Google Omaha with privacy mixins; upstream does not cup2-sign those responses.
- The Solvys browser-update feed (Sparkle/WinSparkle appcasts) is produced by `util/sparkler` (Ed25519 appcast signatures, a separate mechanism).
- cup2 covers the remaining surface: any Omaha-style update endpoint Solvys serves directly (component/extension update feeds that must carry `X-Cup-Server-Proof`). Wired into the browser via the pending `services-endpoints` patch once T1's tree lands.
