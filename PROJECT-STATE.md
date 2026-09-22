---
version: 1
projectId: zenmium
stateRevision: 7
activeSprint: S005 - Helium base
sourceRef: 2026-09-22
sourceCommit: 10eef8c
authorityEnvironment: devin-cloud
syncStatus: aligned
lastVerifiedAt: 2026-09-22T19:30:00Z
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

- S005 dispatched: date branch `2026-09-22` created from `2026-09-12`@`7cf7cf3` at `10eef8c`; preservation ref `refs/sprints/S005/P1`; Devin Cloud sessions `5c8ac5096afe4bcc9aa1fb43b8b416d3` (T1 clone/identity/CI) and `466cb483b12a4229b57a1cfdb274d343` (T4 services) verified repo-attached and on-branch. T2/T3 hold for T1's checkpoint.
- Upstream pins verified live: helium `0.17.2` (Chromium `153.0.8010.52`), helium-macos/helium-windows `0.17.2.2`, helium-services `7f3d42ebf00b`, cup2 `bee47000cd87`, helium-filters `95d0ac36162a`, helium-prism `e73a15554e29`.
- Provider state: `gh` nicharacci ✓, `vercel` tp-solvys ✓, `flyctl` installed but unauthenticated (T4 deploy gate). Local disk ~1 GB free — all local implementation lanes closed; CI/Cloud only.
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

Wave 1 executes in Cloud sessions T1 (clone + rebrand + CI workflows) and T4 (services vendoring + deploy config; deploy gated on Fly auth). On T1's checkpoint `refs/sprints/S005/T1/P1`, dispatch T2 (chrome UI port) and T3 (internal-products contract + agent rail). Unification merges `patches/series` and updates this record. PR #8 merge decision remains TP's.

## Prior lane (V0.0.1 Electron, superseded but intact)

Implementation is in progress on the coordinator branch. The native onboarding lane now discovers stable Google Chrome profiles, creates isolated domain-named Spaces, imports sanitized bookmarks, installs supported extension code, and stores the optional service token through Electron safeStorage. It deliberately does not extract Chrome Login Data, cookies, history, or extension storage; genuine signed 1Password/TOTP handoff remains the credential boundary. Desktop TypeScript and 158 unit tests pass; the native harness reports 36/36 attempted with 0 failures and 2 unavailable trusted-click cases that require host focus in UI verification. Root lint validation is not clean and must not be represented as passed. PR #8 checks are green: the desktop build job and the macOS packaging lane pass on both push and pull_request, and the ad-hoc local-test artifact was signature-verified and launch-tested locally from both ZIP and DMG. The macOS lane previously shipped an ad-hoc plus hardened-runtime bundle that dyld rejected at launch with a Team ID mismatch; that is fixed, and PR runs now sign ad-hoc rather than skipping signing. The earlier billing-lock report is stale; runs execute normally. Next: complete local native/control/authentication tests and capture real composed windows, then evaluate signed/notarized release eligibility. Missing signing or genuine 1Password capability blocks release rather than being silently waived.
