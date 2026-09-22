# S005 - Helium base

## Track T4 - Self-hosted Helium services under Solvys infra

## Problem And Solution

- **Original Problem**: A Helium-cloned Zenmium pointing at `services.helium.imput.net` would send our browser's update checks, extension installs, and bang queries to someone else's infra — wrong for an internal product.
- **Solution**: Solvys Services — a self-hosted clone of `imputnet/helium-services` (plus `cup2` update protocol and `helium-filters`) deployed on Solvys infra from day one, with the browser's service endpoints pointed at it.
- **Outcome Objective**: Deliver Solvys-hosted browser services so Zenmium's updates, extension proxying, bangs, and filter lists answer from infrastructure we control; this track owner is responsible for deploy proof and endpoint wiring.
- **Linear Review Source**: none (Cabinet + `PROJECT-STATE.md` govern)

## Context

TP chose **self-host from day one**. Upstream service surface (verified 2026-09-22):

- `imputnet/helium-services` — `compose.yml`, `deploy/`, `svc/`, `filters/`, `util/`, `setup.sh`, `.env.example`. Docker-composable; serves services.helium.imput.net today. No releases — pin main `7f3d42ebf00b` (2026-09-03).
- `imputnet/cup2` — TypeScript implementation of the Chromium/Omaha Client Update Protocol (the auto-update server Helium uses on macOS/Windows). No releases — pin main `bee47000cd87` (2025-04-13).
- `imputnet/helium-filters` — the content-filtering lists the browser ships/fetches. Pin main `95d0ac36162a` (2026-08-29).

The browser-side consumers live in the T1 tree: `flags.gn` / platform `flags.*.gn`, service URL constants in `browser/patches/`/`resources/`, and updater config in `platform/*/`. This track owns `services/` and the endpoint-wiring patch; T1/T2/T3 consume the hostnames this track publishes.

Deploy lane per Solvys canon: Fly.io is the default host for composed services; `compose.yml` maps to a Fly app or a small VM. **Verified provider state (2026-09-22): `flyctl` is installed at `/opt/homebrew/bin/flyctl` but NOT authenticated — `flyctl auth login` or a `FLY_API_TOKEN` from Workspace Vault is a hard human gate before the deploy half of this track.** `vercel` CLI is authenticated as `tp-solvys` and remains available for any web-facing component. `gh` is authenticated as `nicharacci` (matches the repo remote). **Never** touch app `goalpost` on Fly and never `rm -rf` persist volumes (operating memory law). DNS/hostname for the public service base (e.g. `services.zenmium.*` or a Solvys domain) is a human gate — the deploy must work on its Fly-assigned hostname first.

## Solvys Coding-Agent Contract

- Follow `SOLVYS_AGENT_SYSTEM_PROMPT.md`.
- Provider state changes (deploy, DNS) follow the recorded authorization gates; user-prompted deploy is authorization, unprompted production destroy is not.
- Prove at the highest reality: live endpoints answering real protocol requests, then the built browser consuming them.

## Linear Scope

- **Issue naming**: `S005 - Helium base / T4 - Solvys services`
- **Beta Phase**: Pre-Release
- **Linear Project**: not available
- **Due date**: 2026-09-26
- **Assigned owner**: Codex Cloud (deploy + wiring); TP owns the public-hostname decision

## Branch Target

`2026-09-22`

## Cloud Pickup

- **Sprint identity**: `S005 - Helium base`
- **Accepted plan revision**: `sprint-md/S005-ORCHESTRATION.md` rev 1
- **Environment type**: repository-backed Codex Cloud + Fly.io deploy lane
- **Repository slug**: `nicharacci/zenmium`
- **Base commit**: `2026-09-22` HEAD at dispatch (T4 has no hard dependency on T1's tree for the deploy half; endpoint-wiring patch lands after T1)
- **Date integration branch**: `2026-09-22`
- **Task-owned checkpoint ref**: `refs/sprints/S005/T4/P1`
- **Checkout mode**: detached task-owned worktree
- **Protected zones**: `desktop/**`, Fly app `goalpost`, all persist volumes, DNS until TP picks the hostname
- **Dependencies**: soft on T1 for the wiring patch only; deploy can start immediately
- **Secrets manifest (names only)**: `FLY_API_TOKEN` (deploy lane), service env vars per `services/.env.example` — names only, values via Workspace Vault/Computer
- **Proof gates**: `compose config` clean locally in Cloud; live `curl` health on every deployed svc endpoint; update-protocol request answered by `cup2`; browser flag patch lands
- **Return path**: branch + checkpoint ref + endpoint inventory + health-check receipts
- **Closure condition**: all service endpoints live and wired into the browser flags, or DNS/deploy blocker recorded

## User Testing Inheritance

- **Parent client objective**: Zenmium phones home to Solvys, not imput
- **Inherited acceptance criteria**: every service the browser calls resolves to Solvys infra; browser update check succeeds against self-hosted `cup2`; extension install path flows through the self-hosted proxy
- **Test-data boundary**: fixture extension IDs and bang queries only; no real user traffic
- **Approval posture**: full for deploy to a new Fly app and wiring; **human gate**: public hostname/DNS choice, any paid Fly capacity beyond demo scale
- **Acceptance branch**: `2026-09-22`

## Scope -- Included

- [ ] `services/` — vendored clone of `imputnet/helium-services` at pinned SHA + `services/PROVENANCE.md`; `cup2` and `helium-filters` vendored under `services/vendor/` (or documented fetch) with the same provenance treatment
- [ ] `services/deploy/` — Fly.io app config (`fly.toml`), service-by-service deploy docs, env manifest (names only)
- [ ] `browser/patches/zenmium/services-endpoints.patch` — repoint every Helium service URL (updates, bangs, extension-store proxy, filter lists, component delivery) to the Solvys hostnames
- [ ] `platform/macos` + `platform/windows` updater config — point Sparkle/Omaha-equivalent (`cup2`) update URL at the Solvys endpoint (coordinate file-level changes with T1's platform dirs — T4 owns only the URL/value lines, recorded per-file in this brief's patch list)
- [ ] `services/RUNBOOK.md` — restart, update-publish, filter-list refresh, rollback
- [ ] Import-path validation note: Helium's built-in profile/extension importer verified against a fixture Chrome profile (bookmarks + extensions), recorded in `docs/zenmium/S005-HELIUM-BASE.md` append section

## Scope -- Excluded (DO NOT TOUCH)

- `desktop/**` — frozen.
- Fly app `goalpost` and any persist volume — absolute law.
- Any Zenmium UI patch — T2; control contract — T3.
- Upstream service *code* beyond config/rebrand — clone-and-run, don't rewrite services.
- `browser/patches/series` ordering — unification.

## Frontend Gate

- Design impact: not applicable (infra track). Admin/deploy surfaces, if any emerge, get the token law by default.

## Execution And Storage Lane

- **Execution lane**: Codex Cloud authoring + Fly.io deploy. Local closed (capacity).
- **Workspace path or Cloud branch**: `2026-09-22`
- **Estimated peak storage**: worktree ~1 GB; Fly volumes per `compose.yml` service needs (record actual at deploy)
- **Capacity reservation**: smallest Fly machines per service; scale-up is a TP decision
- **Exit condition**: endpoints live + wired, or recorded blocker
- **Closure state**: active

## Reuse Inventory (existing code to call, not reinvent)

- `helium-services/compose.yml` + `setup.sh` — the deployable unit; don't recompose it
- `cup2` — the update protocol server; wire it before inventing update plumbing
- `helium-filters` — lists ship as-is; no re-authoring
- `docs/zenmium/CHROME-EXTENSIONS.md` — extension-proxy expectations already researched

## Known Issues to Preserve

- Helium's privacy properties must survive the self-host: anonymized extension-store proxying, no logging of browsing data, no analytics. Record the privacy invariant in `services/RUNBOOK.md`.
- No Widevine DRM — upstream limitation, documented not solved.
- Bangs stay local-processed; the service only serves the bang table.

## Implementation Steps

1. Vendor the three upstream repos with provenance; `compose config` sanity pass in Cloud.
2. Create Fly app `zenmium-services` (NOT `goalpost`); deploy services; capture health endpoints.
3. Stand up `cup2`; publish a fixture update entry; verify an Omaha-style request gets a signed-correct response shape.
4. Author `services-endpoints.patch` + platform updater URL changes; coordinate with T1 flags files via `patches/zenmium/SERIES.md` entries.
5. Import-path fixture check; record results.
6. Checkpoint `refs/sprints/S005/T4/P1` + endpoint inventory in the receipt.

## Acceptance Criteria

- [ ] Every browser-called service endpoint resolves to Solvys infra (inventory table in receipt).
- [ ] Update check against self-hosted `cup2` returns a valid protocol response.
- [ ] Extension install path flows through the self-hosted proxy.
- [ ] `services/RUNBOOK.md` covers restart/update-publish/rollback.
- [ ] Privacy invariant recorded; `goalpost` untouched; no secrets in repo.

## Validation Commands

```bash
cd services && docker compose config --quiet
curl -fsS https://<fly-host>/healthz   # per service
# Endpoint wiring check:
grep -rn "helium.imput.net\|imput.net" browser/ platform/ --include='*.gn' --include='*.patch' | grep -v zenmium
# (must return zero unresolved upstream endpoints after the patch)
```

## Commit Format

```
S005 - Helium base / T4

Outcome: ...
Principal areas: services/, browser/patches/zenmium/services-endpoints.patch
Proof: live endpoint receipts + fly status
Protected zones: goalpost app, persist volumes, secrets boundary
Remaining blocker: ...
```
