# Env manifest: Solvys services on Fly (S005/T4)

Every environment variable the fly lane reads, per app. Names only, values never committed; secrets go through `fly secrets set` from the Vault. `[env]` in each fly.toml already carries the non-secret values shown here.

## zenmium-services (edge, deploy/fly/edge/)

| Var | Kind | Required | Notes |
| --- | --- | --- | --- |
| `SERVICES_HOSTNAME` | env | yes (defaulted) | Public hostname; default `zenmium-services.fly.dev` until the DNS decision lands (TP gate) |
| `ROOT_REDIRECT_URL` | env | yes (defaulted) | Target of `GET /` (default `https://solvys.io`) |
| `EXT_UPSTREAM` | env | yes (defaulted) | Internal `host:port` for extension-proxy, default `zenmium-svc-ext.internal:8000` |
| `UBO_UPSTREAM` | env | yes (defaulted) | Internal `host:port` for ubo, default `zenmium-svc-ubo.internal:8000` |
| `BANG_SOURCE` | env | no | Raw URL for hourly bangs.json refresh; empty = serve only the baked copy |

## zenmium-svc-ext (extension proxy, deploy/fly/ext-proxy/)

| Var | Kind | Required | Notes |
| --- | --- | --- | --- |
| `HMAC_SECRET` | secret | for `/ext/` CRX proxying | >=32 chars; signs proxied CRX URLs. Without it, `/ext/` payload proxy is disabled (error logged) but `/com` Omaha passthrough still works |
| `PROXY_BASE_URL` | env | for `/ext/` | Public `/ext/` prefix, default `https://zenmium-services.fly.dev/ext/` |

## zenmium-svc-ubo (uBO lists, deploy/fly/ubo/)

| Var | Kind | Required | Notes |
| --- | --- | --- | --- |
| `UBO_PROXY_BASE_URL` | env | yes | Public `/ubo/` prefix used to rewrite `contentURL`, default `https://zenmium-services.fly.dev/ubo/` |
| `UBO_ASSETS_JSON_URL` | env | no | Custom assets.json manifest source (e.g. our helium-filters generated catalog) |
| `UBO_ASSETS_JSON_SHA256` | env | no | Expected checksum for `UBO_ASSETS_JSON_URL` |
| `UBO_USE_ORIGINAL_UBLOCK_ASSETS` | env | no | Any truthy value bypasses the helium assets catalog |

## zenmium-svc-push (minipush, deploy/fly/minipush/)

| Var | Kind | Required | Notes |
| --- | --- | --- | --- |
| `MINIPUSH_BIND_HOSTNAME` | env | yes | Must be `0.0.0.0` on Fly |
| `MINIPUSH_PORT` | env | yes | `10001` |
| `MINIPUSH_BASE_URL` | env | yes | Public wss URL the browser registers against |
| `MINIPUSH_HMAC_SECRET` | secret | yes | No default; server refuses to start without it |
| `MINIPUSH_ENDPOINT_SECRET` | secret | yes | No default; required |
| `MINIPUSH_MAX_TTL_SECONDS` | env | no | Clamp 0..inf (upstream default 30 effective) |
| `MINIPUSH_MAX_QUEUED_PER_CHANNEL` | env | no | Clamp (upstream default 64) |
| `MINIPUSH_RATE_LIMIT_WINDOW` | env | no | Window ms (default 60000) |
| `MINIPUSH_RATE_LIMIT` | env | no | Requests per window (default 1000) |
| `MINIPUSH_REQUIRE_VAPID` | env | no | Declared upstream, not implemented yet |

## zenmium-svc-crash (minidumpster, deploy/fly/minidumpster/) — phase 2

| Var | Kind | Required | Notes |
| --- | --- | --- | --- |
| `PUBLIC_BASE_URL` | env | yes | Public https URL (OAuth callback base) |
| `SYMBOLICATOR_URL` | env | yes | `http://zenmium-svc-symbolicator.internal:3021` |
| `DATA_DIR` | env | yes | `/data` (mounted volume) |
| `GITHUB_CLIENT_ID` | secret | yes | GitHub OAuth app |
| `GITHUB_CLIENT_SECRET` | secret | yes | GitHub OAuth app |
| `GITHUB_ORG` | env | yes | Org gate for the web UI |
| `GITHUB_ARTIFACT_TOKEN` | secret | no | Enables the Helium artifact crawler |
| `SESSION_SECRET` | secret | yes | `openssl rand -hex 32` |
| `SYMBOL_UPLOAD_TOKEN` | secret | yes | Symbol upload auth |
| `GITHUB_ISSUE_REPO` / `GITHUB_ISSUE_TEMPLATE` | env | no | Prefilled issue button (both or neither) |
| `PORT` / `MAX_DUMP_SIZE_MB` / `RETENTION_DAYS` / `SYMBOLS_RETENTION_DAYS` / `ARTIFACT_CRAWLER_*` | env | no | Defaults set in fly.toml |

## zenmium-svc-symbolicator (deploy/fly/symbolicator/) — phase 2

| Var | Kind | Required | Notes |
| --- | --- | --- | --- |
| (none) | | | Stock `getsentry/symbolicator` image, internal :3021 |

## zenmium-updates (sparkler + static server, deploy/fly/updates/)

| Var | Kind | Required | Notes |
| --- | --- | --- | --- |
| `GITHUB_REPO` | env | yes | Releases repo sparkler reads (T3 output, e.g. `nicharacci/zenmium-macos`) |
| `ED_PRIVATE_KEY` | secret | yes | Base64 Ed25519 private key for appcast `edSignature` |
| `APPCAST_PUBLIC_DIR` | env | yes | `/srv/appcasts` |
| `ASSETS_DIR` | env | yes | `/srv/assets` |
| `GITHUB_ACCESS_TOKEN` | secret | no | Raises GitHub API rate limits |
| `SERVE_ASSETS_LOCALLY` | env | no | `yes` mirrors release binaries at `/assets/` |
| `PORT` | env | no | web process listen port (default 8080) |

## zenmium-svc-cup2 (deploy/fly/cup2/)

| Var | Kind | Required | Notes |
| --- | --- | --- | --- |
| `CUP2_PRIVATE_KEY_PKCS8_B64` | secret | yes | Base64 PKCS8 ECDSA P-256 private key (generate command in fly.toml comment) |
| `CUP2_KEY_ID` | env | yes | Key id clients pass as `cup2key=<id>:<nonce>` (default `1`) |
| `UPDATE_MANIFEST_JSON` | env | yes | Inline JSON map `appid -> {version, codebase, hash_sha256, size}` |
| `PORT` | env | no | default `8080` |
