---
version: 1
projectId: zenmium
stateRevision: 3
activeSprint: V0.0.1
sourceRef: 2026-09-12
sourceCommit: 273a51f
authorityEnvironment: goalpost-code
syncStatus: unverified
---

# Project state

One Git-tracked truth file. Chat is not the source of truth. No secrets.

## Current intent

Complete Zenmium v0.0.1 as a standalone macOS browser with isolated persistent Workspace profiles, native Chromium views owned by ArcCore, the accepted Zen-inspired liquid-glass shell, a full-height nonmodal BeUI chat dock, one optional OpenCode loop, genuine 1Password/TOTP, and an authenticated local control contract for future Goalpost embedding. No Goalpost Code/CRM deployment or live sign-off is required. App source lives in `desktop/`. The active implementation ownership and acceptance ledger is `docs/zenmium/SPRINT-V0.0.1.md`; the user's latest approved requirements supersede earlier sidebar/profile scope limits.

## Protected zones

- Do not commit `.env`, cookie jars, Browser Profiles, or any secret value.
- Secrets, data-store credentials, and keys come from the 1Password browser extension in Zen. Names in context, values never. No 1Password CLI. See `docs/zenmium/SECRETS.md`.
- `BrowserCore` is the only Chromium boundary; no renderer imports Electron or touches Chromium.
- One agent loop (OpenCode). No second chat engine.
- `main` stays protected and deployable. Work stays on `2026-09-12` and is reviewed through existing PR #8; merge/release require passing gates.
- The sole canonical logo is `docs/zenmium/brand/zenmium-canonical.png`. Preserve its approved appearance; format derivatives are not new design candidates.
- No raw global debugging endpoint, plaintext pairing-secret persistence, credential value in an agent observation, or signature/native-messaging bypass. Apply permission, blocking, and extension policy to every browser profile.

## Next safe action

Implementation is in progress on the coordinator branch. The native onboarding lane now discovers stable Google Chrome profiles, creates isolated domain-named Spaces, imports sanitized bookmarks, installs supported extension code, and stores the optional service token through Electron safeStorage. It deliberately does not extract Chrome Login Data, cookies, history, or extension storage; genuine signed 1Password/TOTP handoff remains the credential boundary. Desktop TypeScript and 112 unit tests pass. Root lint validation is not clean and must not be represented as passed. PR #8's latest build run `34779444455` did not start because GitHub reported a billing-locked account; no protected gate has been bypassed. Complete local native/control/authentication tests and capture real composed windows, then evaluate signed/notarized release eligibility. Missing signing or genuine 1Password capability blocks release rather than being silently waived.
