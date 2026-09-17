---
version: 1
projectId: zenmium
stateRevision: 5
activeSprint: V0.0.1
sourceRef: 2026-09-12
sourceCommit: dc2850d
authorityEnvironment: goalpost-code
syncStatus: aligned
lastVerifiedAt: 2026-09-17T21:49:16Z
latestReceipt: docs/zenmium/S002-receipt.md
---

# Project state

One Git-tracked truth file. Chat is not the source of truth. No secrets.

## Current intent

Complete Zenmium v0.0.1 as a standalone macOS browser with isolated persistent Workspace profiles, native Chromium views owned by ArcCore, the accepted Zen-inspired liquid-glass shell, a full-height nonmodal BeUI chat dock, one optional OpenCode loop, genuine 1Password/TOTP, and an authenticated local control contract for future Goalpost embedding. No Goalpost Code/CRM deployment or live sign-off is required. App source lives in `desktop/`. The active implementation ownership and acceptance ledger is `docs/zenmium/SPRINT-V0.0.1.md`; the user's latest approved requirements supersede earlier sidebar/profile scope limits.

## Protected zones

- Do not commit `.env`, cookie jars, Browser Profiles, or any secret value.
- Secrets, data-store credentials, and keys come from the 1Password browser extension in Zen. Names in context, values never. The 1Password CLI lane is permitted only under the operator-authorized override recorded in `docs/zenmium/SECRETS.md` (2026-09-16). See that file for the lane contract.
- `BrowserCore` is the only Chromium boundary; no renderer imports Electron or touches Chromium.
- One agent loop (OpenCode). No second chat engine.
- `main` stays protected and deployable. Work stays on `2026-09-12` and is reviewed through existing PR #8; merge/release require passing gates.
- The sole canonical logo is `docs/zenmium/brand/zenmium-canonical.png`. Preserve its approved appearance; format derivatives are not new design candidates.
- No raw global debugging endpoint, plaintext pairing-secret persistence, credential value in an agent observation, or signature/native-messaging bypass. Apply permission, blocking, and extension policy to every browser profile.

## Current truth

- Branch `2026-09-12` is synced with origin at `693ac96`; PR #8 checks (`build`, `macos` push and pull_request) are green and the PR is mergeable.
- The macOS local-test lane produces a launchable ad-hoc artifact on both push and PR events; the ad-hoc plus hardened-runtime dyld crash and the PR signing skip are fixed and verified by local launch of the CI-produced ZIP and DMG.
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

## Next safe action

Implementation is in progress on the coordinator branch. The native onboarding lane now discovers stable Google Chrome profiles, creates isolated domain-named Spaces, imports sanitized bookmarks, installs supported extension code, and stores the optional service token through Electron safeStorage. It deliberately does not extract Chrome Login Data, cookies, history, or extension storage; genuine signed 1Password/TOTP handoff remains the credential boundary. Desktop TypeScript and 158 unit tests pass; the native harness reports 36/36 attempted with 0 failures and 2 unavailable trusted-click cases that require host focus in UI verification. Root lint validation is not clean and must not be represented as passed. PR #8 checks are green: the desktop build job and the macOS packaging lane pass on both push and pull_request, and the ad-hoc local-test artifact was signature-verified and launch-tested locally from both ZIP and DMG. The macOS lane previously shipped an ad-hoc plus hardened-runtime bundle that dyld rejected at launch with a Team ID mismatch; that is fixed, and PR runs now sign ad-hoc rather than skipping signing. The earlier billing-lock report is stale; runs execute normally. Next: complete local native/control/authentication tests and capture real composed windows, then evaluate signed/notarized release eligibility. Missing signing or genuine 1Password capability blocks release rather than being silently waived.
