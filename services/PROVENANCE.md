# Provenance: services/

Self-hosted Zenmium services lane for S005 / track T4. The browser's update checks, extension installs, bangs, dictionaries, uBO lists, and push notifications answer from Solvys-controlled infrastructure instead of imput. Vendored trees are byte-identical to their pinned upstream commits; Solvys-added files are listed at the bottom.

## Vendored trees

| Path | Upstream repo | Pinned commit | Commit date | License |
| --- | --- | --- | --- | --- |
| `services/` (this tree) | https://github.com/imputnet/helium-services | `7f3d42ebf00bcb8fa8e36f289bfa895f39c604da` | 2026-09-03 | AGPL-3.0 |
| `services/vendor/cup2/` | https://github.com/imputnet/cup2 | `bee47000cd87162499ec58970113929b22c03bd7` | 2025-04-13 | AGPL-3.0 |
| `services/vendor/helium-filters/` | https://github.com/imputnet/helium-filters | `95d0ac36162abf99c5d3bca0ab1c9e7b9e059a50` | 2026-08-29 | GPL-3.0 (code); bundled lists keep per-list licenses |

None of the three repos publishes releases; the pins are main-branch commits verified live on 2026-09-22. Each subtree keeps its own `LICENSE` and carries a `PROVENANCE.md` (this file for the root tree; `vendor/<name>/PROVENANCE.md` for the vendor trees).

Vendoring method: `rsync -a --exclude='.git'` from a checkout of the pinned commit. No source edits, no rebranding inside vendored code; everything Solvys adds lives in new paths.

## helium-filters submodules (documented fetch, not vendored)

`vendor/helium-filters/.gitmodules` pins two build inputs that are fetched at generate time, not vendored:

| Path | Upstream | Pinned commit |
| --- | --- | --- |
| `vendor/helium-filters/helium-services/` | https://github.com/imputnet/helium-services | `216659920667626cc60f7f8e5031ddf8cdf4827c` |
| `vendor/helium-filters/ublock/` | https://github.com/imputnet/uBlock | `c2c1eca76fe28adae9e8b1f655d39a4a007e486e` |

See `vendor/helium-filters/PROVENANCE.md` for the reproduction recipe.

## What the tree provides

| Piece | Path | Role |
| --- | --- | --- |
| nginx edge | `svc/nginx/` | Public routing: `/bangs.json`, `/dict/`, `/ext/`, `/com`, `/ubo/`, `/connectivitycheck` |
| extension-proxy | `svc/extension-proxy/` | Extension install/update proxy (Omaha via Google with privacy mixins, CWS snippets, payload proxy) |
| ubo | `svc/ubo/` | uBO filter-list mirror (`/ubo/assets.json`, `/ubo/<id>/<hash>/<hash>/<file>` proxy paths) |
| minipush | `svc/minipush/` | Minimal autopush websocket endpoint (browser push notifications) |
| minidumpster | `svc/minidumpster/` | Crash-report ingest + getsentry/symbolicator sidecar (phase 2) |
| bangs | `svc/bangs/` | `bangs.json` source + refresh script |
| sparkler | `util/sparkler/` | Hourly daemon producing Sparkle/WinSparkle appcasts (`appcast-{arm64,x86_64}.xml`) |
| release-collector | `util/release-collector/` | Release-asset collector used by upstream packaging |
| filters | `filters/` | Upstream filter tooling |
| cup2 (vendored) | `vendor/cup2/` | CUP-ECDSA signature library for Omaha-style update responses |
| helium-filters (vendored) | `vendor/helium-filters/` | Generator for the browser's bundled uBO snapshot |

## Solvys-added paths

| Path | Purpose |
| --- | --- |
| `PROVENANCE.md`, `RUNBOOK.md` | This file; operator runbook |
| `vendor/cup2/PROVENANCE.md`, `vendor/helium-filters/PROVENANCE.md` | Per-tree provenance |
| `deploy/fly/` | Fly.io lane (fly.toml per app, fly-adapted nginx config, cup2 signing edge, deploy script, env manifest, deploy guide) |
| `pending/` | Work staged for T1's `browser/` tree: `services-endpoints.patch`, intended series entry, platform updater notes |

Upstream `deploy/` (Ansible) is retained untouched for reference; the Fly lane lives alongside it under `deploy/fly/` rather than modifying it.

## Intentional deviations from upstream deployment

- TLS terminates at the Fly edge (certificates, HTTP/2) instead of upstream's acme.sh sidecar; the fly nginx listens on plain :8080 internally. No acme.sh container, no `/etc/nginx/ssl` volume.
- Per-service Fly apps replace the single-host compose pod; service-to-service traffic rides the Fly private network (`<app>.internal`) instead of the compose `services` subnet.
- `MINIPUSH_BIND_HOSTNAME=0.0.0.0` is required on Fly (upstream defaults to 127.0.0.1 loopback inside a container).
- Bangs/dictionaries are baked into the edge image at build; the upstream `refresh-bangs.sh` / `refresh-dicts.sh` boot refresh remains available via env override.
- Privacy invariant is unchanged: no request logging beyond upstream defaults (nginx access_log off), no analytics, and the extension proxy's anonymized mixin (fresh `x`/`y` download params, UA overwrite) is preserved verbatim.
