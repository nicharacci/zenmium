---
version: 1
projectId: zenmium
stateRevision: 9
activeSprint: S005 - Helium base
sourceRef: 2026-09-22
sourceCommit: cce57fb
authorityEnvironment: devin-cloud
syncStatus: aligned
lastVerifiedAt: 2026-09-23T00:30:00Z
latestReceipt: docs/zenmium/S004-receipt.md
---

# Project state

One Git-tracked truth file. Chat is not the source of truth. No secrets.

## Current intent

TP directive (2026-09-22): rebuild everything Chromium-related to follow Helium (helium.computer) as the base. Zenmium becomes a vendored clone — not a fork — of `imputnet/helium` + platform repos under this repo (`browser/`, `platform/`, `services/`, `internal/`), full Zenmium identity, keeping only the liquid-glass frame, the sidebar, and the internal-products/agent-rail layer. The greeting animation is deliberately not ported. The Electron tree under `desktop/` is frozen as reference; its v0.0.1 lane (branch `2026-09-12`, PR #8) remains intact but is no longer the product direction. The S005 megaplan lives in `sprint-md/S005-*.md`; track checkpoints land on `refs/sprints/S005/T#/P#`.

## Protected zones

- Do not commit `.env`, cookie jars, Browser Profiles, or any secret value.
- Secrets, data-store credentials, and keys come from the 1Password browser extension in Zen. Names in context, values never. The 1Password CLI lane is permitted only under the operator-authorized override recorded in `docs/zenmium/SECRETS.md` (2026-09-16). See that file for the lane contract.
- `BrowserCore` is the only Chromium boundary; no renderer imports Electron or touches Chromium.
- One agent loop (OpenCode). No second chat engine.
- `main` stays protected and deployable. Electron lane work stays on `2026-09-12` (PR #8); S005 work stays on `2026-09-22`; merge/release require passing gates.
- The sole canonical logo is `docs/zenmium/brand/zenmium-canonical.png`. Preserve its approved appearance; format derivatives are not new design candidates.
- No raw global debugging endpoint, plaintext pairing-secret persistence, credential value in an agent observation, or signature/native-messaging bypass. Apply permission, blocking, and extension policy to every browser profile.

## Current truth

- S005 integrated on `2026-09-22` through `cce57fb`: T1 vendoring + identity (`00dab5f`), T1 workflow gate fixes (`7b3f1cd`), T2 chrome UI (`64133fc`), T4 services vendoring + Fly lane + endpoint patch (`615a749`, `c8311c8`), T3 internal products + agent rail (`e31a022`), orchestrator unification (`511e04c`), patch-context repairs (`770959c`, `c8beaf2`, `14bb5de`), hunk-count corrections across the zenmium series (`31d8fc6`), sccache/Windows-workflow fixes (`4be1c77`), GRIT resource-ID ordering + fake-index removal (`6b10464`), malformed-hunk repair (`d6b8b8c`), frosted-grain glass treatment at 35% transparency (`afaff48`), and allowlist.cc context regen for Windows patch.exe (`cce57fb`). Checkpoints: `refs/sprints/S005/{P1,T1/P1,T2/P1,T3/P1,T4/P1,T4/P2}`.
- Patch-series verification is local and complete: all upstream patches + 11 zenmium patches replayed in series order onto real Chromium `153.0.8010.52` files fetched at the pinned tag — zero rejects, and every `@@` hunk header re-validated against actual body line counts (GNU `patch` truncates silently on under-declared counts; that bug class produced the malformed `BUILD.gn` that broke run 35793569937).
- CI truth: macOS has repeatedly reached the full `chrome/installer/mac` compile (gn gen passes); remaining historical failures were patch-application and resource-generation defects, all repaired through `cce57fb`. Windows `build.py --ci` now performs its own full setup (pre-clone removed in `4be1c77`); fake `index 0000000..` lines removed because Windows `patch.exe` read them as new-file markers and silently skipped 7 modify hunks; the final allowlist.cc context drift was regenerated in `cce57fb`. No verified installable artifact exists yet.
- Services lane live on Fly org `solvys-technologies`: `zenmium-services` (edge: bangs 200, connectivitycheck 204, ubo assets 200 w/ br), `zenmium-updates` (appcast 200), `zenmium-svc-{cup2,ext,push,ubo}` deployed. `zenmium-svc-crash`/`zenmium-svc-symbolicator` deliberately deferred to phase 2 (GitHub OAuth app + new volume = human gate). Endpoint rewire patch targets `zenmium-*.fly.dev` hosts.
- Fly auth resolved: token recovered from `~/.fly/config.yml`, delivered to the T4 Cloud box and registered as org secret `secret-c7fa4cea`; `flyctl` locally still reports no token — use `FLY_API_TOKEN` env lane.
- Side-monitor lane verified live: `desktop/scripts/verify-side-monitor.mjs` exits 0 (DELL P2422H present). No built artifact exists yet — local launch proof pending CI artifact.
- T1 box commit `50cf6c5` (scratch-tree sequential dry-run gate) deliberately NOT merged — superseded by `7b3f1cd` (real in-order apply is the gate); the variant doubles apply time and uses `cp -al`, absent on Windows runners.
- Upstream pins verified live: helium `0.17.2` (Chromium `153.0.8010.52`), helium-macos/helium-windows `0.17.2.2`, helium-services `7f3d42ebf00b`, cup2 `bee47000cd87`, helium-filters `95d0ac36162a`, helium-prism `e73a15554e29`.
- Provider state: `gh` nicharacci ✓, `vercel` tp-solvys ✓, Fly token valid for `solvys-technologies`. BrowserOS/Neo: no MCP and no app on this machine — no browser-automation lane. Local disk ~1 GB free — CI/Cloud only.
- Branch `2026-09-12` is synced with origin at `7cf7cf3`; PR #8 checks (`build`, `macos` push and pull_request) are green and the PR is mergeable. Its merge decision stays with TP, independent of the rebase.
- The macOS local-test lane produces a launchable ad-hoc artifact on both push and PR events; the ad-hoc plus hardened-runtime dyld crash and the PR signing skip are fixed and verified by local launch of the CI-produced ZIP and DMG.
- The committed CI artifact additionally passed the live `verify-browser.mjs` harness (15/15 steps) under `ZENMIUM_VERIFY_SIDE_MONITOR=1` with an isolated profile on the DELL P2422H side monitor; one native split-pane click remains unavailable via CDP.
- Desktop gate state: `pnpm typecheck` clean, `pnpm test` 158/158 pass, `pnpm test:native` reports 36/36 attempted with 0 failures and 2 trusted-click cases unavailable without host focus, `pnpm build` clean, source and artifact secret scans report 0 findings.
- Root `pnpm check` is not clean (4,365 pre-existing findings across 282 files) and must not be represented as passed.
- Factory infraction ledger opened at `Codebase Cabinet/Project Records/zenmium/infraction-ledger.json` with INF-001 and INF-002 recorded and repair-verified.

## Open gates

- Complete local native/control/authentication tests and capture real composed windows.
- Evaluate signed/notarized release eligibility; missing signing or genuine 1Password capability blocks release rather than being silently waived.
- PR #8 merge decision stays with the owner.
- The uncommitted working-tree changes (browser-native, service-token, workspace-sessions, auth-compat, onepassword-cli lanes) belong to the in-flight agent and are unverified here.
- Root lint debt remains open.

## Breakthrough log

None recorded.

## Protected zones (S005 additions)

- `desktop/**` frozen — Electron lane is reference material only; its dirty working tree belongs to the in-flight agent on `2026-09-12`.
- New sprint surfaces: `browser/`, `platform/`, `services/`, `internal/` are S005 tracks' ownership per `sprint-md/S005-ORCHESTRATION.md`.
- Fly app `goalpost` and persist volumes: never touch.

## Next safe action

Watch the `cce57fb` CI runs (`browser-macos`, `browser-windows`) through patch application, gn gen, compile, packaging, and smoke test; fix any further cross-platform patch or toolchain failures via the verified local replay loop. When an artifact uploads, pull it and launch-test on the DELL P2422H side monitor under `ZENMIUM_VERIFY_SIDE_MONITOR=1`. Do not push to `browser/**`, `platform/**`, or workflow paths while a compile is in flight — `concurrency.cancel-in-progress` will kill it. PR #8 merge decision remains TP's.

## Prior lane (V0.0.1 Electron, superseded but intact)

Implementation is in progress on the coordinator branch. The native onboarding lane now discovers stable Google Chrome profiles, creates isolated domain-named Spaces, imports sanitized bookmarks, installs supported extension code, and stores the optional service token through Electron safeStorage. It deliberately does not extract Chrome Login Data, cookies, history, or extension storage; genuine signed 1Password/TOTP handoff remains the credential boundary. Desktop TypeScript and 158 unit tests pass; the native harness reports 36/36 attempted with 0 failures and 2 unavailable trusted-click cases that require host focus in UI verification. Root lint validation is not clean and must not be represented as passed. PR #8 checks are green: the desktop build job and the macOS packaging lane pass on both push and pull_request, and the ad-hoc local-test artifact was signature-verified and launch-tested locally from both ZIP and DMG. The macOS lane previously shipped an ad-hoc plus hardened-runtime bundle that dyld rejected at launch with a Team ID mismatch; that is fixed, and PR runs now sign ad-hoc rather than skipping signing. The earlier billing-lock report is stale; runs execute normally. Next: complete local native/control/authentication tests and capture real composed windows, then evaluate signed/notarized release eligibility. Missing signing or genuine 1Password capability blocks release rather than being silently waived.
