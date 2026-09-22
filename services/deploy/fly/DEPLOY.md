# Deploying Solvys services to Fly.io (S005/T4)

This lane deploys the vendored helium-services tree as per-service Fly apps, faithful to upstream `compose.yml` but with TLS terminated at the Fly edge instead of acme.sh. Gated on human `fly auth` — prepare everything, then run through this once flyctl is authenticated on the control plane.

Do NOT touch the `goalpost` app or any existing volumes. All apps below are new.

## App map

| App | Source | Exposure | Internal port | Status |
| --- | --- | --- | --- | --- |
| `zenmium-services` | `deploy/fly/edge/` (nginx) | public :80/:443 | 8080 | core |
| `zenmium-svc-ext` | `svc/extension-proxy/` | internal only | 8000 | core |
| `zenmium-svc-ubo` | `svc/ubo/` | internal only | 8000 | core |
| `zenmium-svc-push` | `svc/minipush/` | public :80/:443 (wss) | 10001 | core |
| `zenmium-updates` | `util/sparkler/` + `deploy/fly/updates/` | public :80/:443 | 8080 | core |
| `zenmium-svc-cup2` | `deploy/fly/cup2/` | public :80/:443 | 8080 | core (dormant until T1 wires signed feeds) |
| `zenmium-svc-crash` | `svc/minidumpster/` | public :80/:443 | 8080 | phase 2 (needs OAuth app + volume) |
| `zenmium-svc-symbolicator` | `getsentry/symbolicator` image | internal only | 3021 | phase 2 |

Deploy order matters: the edge resolves `.internal` upstreams at request time, but a missing app makes every proxied route 502. Internal apps first, edge last.

## One-time setup

```sh
fly auth login
fly apps create zenmium-services zenmium-svc-ext zenmium-svc-ubo \
    zenmium-svc-push zenmium-updates zenmium-svc-cup2
# or let `fly deploy` create each app from its fly.toml (name is already set)
```

Pull secret values from the Vault (names only in this repo; see `env-manifest.md`) and set them before first deploy:

```sh
fly -a zenmium-svc-ext   secrets set HMAC_SECRET=<vault> 
fly -a zenmium-svc-push  secrets set MINIPUSH_HMAC_SECRET=<vault> MINIPUSH_ENDPOINT_SECRET=<vault>
fly -a zenmium-updates   secrets set ED_PRIVATE_KEY=<base64 ed25519> GITHUB_ACCESS_TOKEN=<optional>
fly -a zenmium-svc-cup2  secrets set CUP2_PRIVATE_KEY_PKCS8_B64=<base64 pkcs8 ecdsa p256>
```

Non-secret config that still needs a decision (edit `[env]` in each fly.toml or use `fly -a <app> secrets set` for ad-hoc override): `GITHUB_REPO` for zenmium-updates (T3 releases repo), `UPDATE_MANIFEST_JSON` for cup2, `GITHUB_ORG` for crash.

## Deploy (from the repo root, build context is services/)

```sh
cd services
fly deploy -c deploy/fly/ubo/fly.toml         --remote-only
fly deploy -c deploy/fly/ext-proxy/fly.toml   --remote-only
fly deploy -c deploy/fly/minipush/fly.toml    --remote-only
fly deploy -c deploy/fly/cup2/fly.toml        --remote-only
fly deploy -c deploy/fly/updates/fly.toml     --remote-only
fly deploy -c deploy/fly/edge/fly.toml        --remote-only   # edge last
```

`--remote-only` builds on Fly's builders so no local docker daemon is needed. `deploy/fly/up.sh` runs the same sequence.

## Phase 2: crash reporting (when the browser's crash endpoint is wired)

```sh
fly apps create zenmium-svc-crash zenmium-svc-symbolicator
fly volumes create crash_data --size 1 -r iad -a zenmium-svc-crash   # NEW volume on the NEW app only
fly -a zenmium-svc-crash secrets set \
    GITHUB_CLIENT_ID=<oauth app> GITHUB_CLIENT_SECRET=<oauth> \
    SESSION_SECRET=$(openssl rand -hex 32) SYMBOL_UPLOAD_TOKEN=<vault>
fly deploy -c deploy/fly/symbolicator/fly.toml --remote-only
fly deploy -c deploy/fly/minidumpster/fly.toml --remote-only
```

The GitHub OAuth app's callback must be `https://zenmium-svc-crash.fly.dev/auth/callback`. Consider pinning `getsentry/symbolicator` to a digest instead of `latest`.

## Health checks (post-deploy sweep)

```sh
curl -fsS -o /dev/null -w '%{http_code}\n' https://zenmium-services.fly.dev/connectivitycheck   # 204
curl -fsS https://zenmium-services.fly.dev/bangs.json | head -c 200                            # JSON
curl -fsS https://zenmium-services.fly.dev/dict/ | head                                        # autoindex of hunspell dirs (after refresh-dicts completes)
curl -fsS --compressed 'https://zenmium-services.fly.dev/ext/?response=redirect&x=id%3Daeblfdkhhhdcdjpifhhbdiojplfjncoa%26uc' -o /dev/null -w '%{http_code}\n'  # 302/200
curl -fsS --compressed https://zenmium-services.fly.dev/ubo/assets.json | head -c 200          # brotli assets.json
curl -fsS https://zenmium-svc-push.fly.dev/healthcheck                                        # minipush health
curl -fsS https://zenmium-svc-cup2.fly.dev/healthz                                            # cup2 health
curl -fsS https://zenmium-updates.fly.dev/appcast-arm64.xml | head                            # after sparkler's first write
```

Machine-side checks are also declared per app (`[[services.checks]]` in each fly.toml); `fly checks list -a <app>` / `fly status -a <app>` shows them.

## Endpoint coverage map (what the browser will hit)

| Browser path | Served by | Backing |
| --- | --- | --- |
| `GET /bangs.json` | edge | baked `svc/bangs/bangs.json` + optional refresh |
| `GET /dict/*` | edge | refresh-dicts.sh chromium hunspell tarball |
| `GET /ext/*` | edge → `zenmium-svc-ext` | extension proxy (CRX payload proxy, CWS snippet) |
| `GET/POST /com` | edge → `zenmium-svc-ext` | Omaha passthrough to Google with privacy mixins |
| `GET /ubo/assets.json`, `/ubo/<id>/<h>/<h>/<file>` | edge → `zenmium-svc-ubo` | list mirror, brotli only |
| `GET /connectivitycheck` | edge | 204 (Chromium captive-portal check) |
| `wss://zenmium-svc-push.fly.dev/` | minipush | autopush notifications |
| `GET /appcast-{arm64,x86_64}.xml` | zenmium-updates | sparkler + GitHub releases |
| `POST /update?cup2key=..` | zenmium-svc-cup2 | CUP-ECDSA-signed Omaha-style responses |
| `POST /crash` (phase 2) | zenmium-svc-crash | minidumpster + symbolicator |

## DNS / hostname note

Everything works on Fly-assigned `*.fly.dev` hostnames first. When the TP gate decides the real hostname (e.g. `services.<zenmium-domain>`): set `SERVICES_HOSTNAME`, `PROXY_BASE_URL`, `UBO_PROXY_BASE_URL`, `MINIPUSH_BASE_URL`, `PUBLIC_BASE_URL`, then `fly certs add <hostname>` on each public app and repoint DNS.
