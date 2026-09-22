# RUNBOOK: Solvys services (zenmium-services on Fly.io)

Operator runbook for the self-hosted services lane (S005/T4). App map, env vars, and first-deploy steps live in `deploy/fly/DEPLOY.md` and `deploy/fly/env-manifest.md`; this file covers day-2 operations.

Privacy invariant for everything below: no request logging beyond upstream defaults (nginx `access_log off`, no analytics anywhere in the tree), and the extension proxy's anonymized mixin (fresh `x`/`y` download params per request, fixed UA overwrite) must be preserved verbatim when upstream code is updated.

## App map

| App | Role | Public |
| --- | --- | --- |
| `zenmium-services` | nginx edge (bangs, dicts, /ext, /com, /ubo) | yes |
| `zenmium-svc-ext` | extension install/update proxy | internal |
| `zenmium-svc-ubo` | uBO list mirror | internal |
| `zenmium-svc-push` | minipush websocket notifications | yes (wss) |
| `zenmium-updates` | sparkler daemon + appcast file server | yes |
| `zenmium-svc-cup2` | CUP-ECDSA-signed update edge | yes (dormant until wired) |
| `zenmium-svc-crash` | minidumpster crash ingest (phase 2) | yes |
| `zenmium-svc-symbolicator` | symbolicator sidecar (phase 2) | internal |

## Health and restarts

Per-app machine checks are declared in each `deploy/fly/*/fly.toml` (`[[services.checks]]`); the external curl sweep is in `deploy/fly/DEPLOY.md` ("Health checks").

```sh
fly status -a zenmium-services            # machine + check state
fly logs  -a zenmium-svc-ext --since 1h
fly machine restart -a zenmium-svc-ubo <machine-id>   # or: fly apps restart <app>
```

Restart order matters only for the edge's upstream resolution (it re-resolves per request via the Fly internal resolver, so no ordering is strictly required). If an internal app is fully down, `/ext`, `/com`, or `/ubo` return 502 at the edge until it is back.

## Publishing a browser update (appcast feed)

`zenmium-updates` regenerates `appcast-arm64.xml` and `appcast-x86_64.xml` hourly from GitHub releases of `GITHUB_REPO` (the T3 releases repo), signing each enclosure with `ED_PRIVATE_KEY` (Ed25519; the browser verifies against the public key baked into T2/T3).

1. Publish the release in `GITHUB_REPO` with the per-arch DMG assets named to match sparkler's asset mapping (see `util/sparkler/lib/assets.ts`).
2. Either wait for the next hourly run or force a regenerate: `fly machine exec -a zenmium-updates <worker-machine-id> "deno run -A /app/main.ts oneshot"` (the `oneshot` arg runs one pass and exits).
3. Verify: `curl -fsS https://zenmium-updates.fly.dev/appcast-arm64.xml | grep sparkle:version`.

## Refreshing filter lists (uBO)

`zenmium-svc-ubo` mirrors the helium uBO catalog at serve time; it refreshes its in-memory copy on restart. To force a refresh: `fly apps restart zenmium-svc-ubo` then verify `curl -fsS --compressed https://zenmium-services.fly.dev/ubo/assets.json`.

To ship a Solvys-curated catalog instead of the helium default, generate `assets/assets.json` with `vendor/helium-filters` (see `vendor/helium-filters/PROVENANCE.md`), host it, and set `UBO_ASSETS_JSON_URL` (+ `UBO_ASSETS_JSON_SHA256`) on `zenmium-svc-ubo`.

To refresh `bangs.json`: update `svc/bangs/bangs.json` upstream-pin style (run `svc/bangs/bump-version.sh` against the kagisearch/bangs release), redeploy the edge, or set `BANG_SOURCE` on `zenmium-services` to auto-refresh hourly from a raw URL.

## Rolling back

Every `fly deploy` keeps the prior image; roll back per app with `fly deploy -a <app> --image <previous-image-ref>` (list via `fly releases -a <app>`). For a bad vendored bump, revert the commit on `2026-09-22` and redeploy. The checkpoint ref `refs/sprints/S005/T4/P1` marks the T4-complete tree.

## Updating vendored code

1. Pick the new upstream pin for the repo (helium-services, cup2, or helium-filters).
2. Re-vendor with `rsync -a --exclude='.git'` from a checkout of that commit, keeping the `PROVENANCE.md` files and updating their pin rows.
3. Do not edit vendored sources; put deviations in `deploy/fly/` only. If an upstream file must change, record it in `PROVENANCE.md` under "Intentional deviations".
4. `docker compose config --quiet` (from `services/`) still validates the upstream compose view; validate fly.toml changes with `fly config validate -a <app>`.

## What's still gated

- `fly auth login` on the control plane (all `fly deploy` / `fly secrets` calls).
- `FLY_API_TOKEN` does not exist in the Vault yet; the deploy half of T4 waits on it.
- DNS/hostname decision is a TP human gate; the stack works on `*.fly.dev` names first.
- `browser/` wiring (the `services-endpoints` patch) is staged under `pending/` until T1's tree lands.
