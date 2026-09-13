# Zenmium v0.0.1 implementation ledger

Status: implementation in progress. No release gate has been declared passed. User-approved scope is native browser completion, Workspace profiles, genuine 1Password/TOTP, agent ergonomics, and independently tested future Goalpost integration contracts. No Goalpost Code/CRM deployment or sign-off is required.

## Integration contracts and ownership

- ArcCore remains the native tab/profile authority. Core owner owns `arc-core.ts`, profile migration/session modules, `shared/ipc.ts`, and native-core tests. Add `getSessionForSpace(spaceId)`, `getProfileId(spaceId)`, and `getWebContentsForTab(tabId)` for main-process consumers. `newTab` accepts optional `background` and `ownerSessionId`; defaults retain existing behavior. Native views may never cross profile partitions.
- Control owner owns new `shared/browser-control.ts`, `main/browser-control*`, and control tests. All control access flows through scoped authenticated actors, ownership, revision checks, and observable receipts. Consumers use the public ArcCore seams above. Do not modify ArcCore or the app entrypoint directly.
- Chat owner owns `agent-kernel.ts`, new agent/chat shared types and persistence modules, renderer chat wrappers/history, and chat-focused styles/tests. Preserve BeUI source internals. Report integration edits needed in `index.ts`/`browser-chrome.ts`; do not edit those shared entrypoints.
- Extensions/authentication owner owns extension host, installer, new native-messaging/authentication modules and tests. A host is bound to one profile/session; main integration supplies that profile session. No CLI secrets, browser identity spoofing, or unsupported authentication success claims.
- Integrator exclusively owns `index.ts`, `browser-chrome.ts`, security wiring, preload integration, package metadata/lockfiles, and release gates until delegated explicitly. Shared file changes require coordination. Contributors must preserve all pre-existing user changes and use apply_patch for edits. No contributor commits, pushes, merges, or publishes independently.
- Agent execution is one window and one reusable owned tab by default, does not activate/focus, and never silently adopts a human tab. Human takeover fences mutations. UI and external integrations share native action semantics.

## Required completion evidence

- Profile migration backup, session isolation, history/permissions/extensions isolation, restart restoration, safe cross-profile tab movement.
- Real ordinary browser actions and utilities; accepted liquid-glass shell; full-height nonmodal BeUI chat dock; no empty essentials strip.
- Genuine signed browser/1Password integration and acknowledged TOTP; no credential values in logs, model observations, or transcripts.
- Quiet background control, authenticated/revocable bridge, stale revision and takeover rejection, local client conformance, no duplicate mutation after reconnect.
- TypeScript, production build, unit/native/UI tests, complete native-window captures, and measured weighted parity matrix (95% target; every critical flow mandatory).
- Canonical approved logo only, derivative export fidelity, Zenmium bundle naming/default-browser registration, onboarding, signed/notarized prerelease artifacts.

## Release policy

Work on `2026-09-12`, update existing PR #8, honor protected main. Merge/tag/publish v0.0.1 only after mandatory gates pass. Missing signing credentials or native 1Password compatibility is a blocker, not a waived gate. Never commit secrets, profiles, or unrelated user assets. Pre-existing changes are preserved, not reset.

## Security addition (user approved 2026-09-13)

- Apply packaged Electron fuses before signing: disable RunAsNode, NODE_OPTIONS and CLI inspection; enable cookie encryption, embedded ASAR integrity and ASAR-only loading. Read the resulting fuse wire back during artifact verification.
- Add Ghostery's Electron blocker to every Workspace session, retaining native popup/permission policy as a separate authority. Cache filter data, report protection failures honestly, provide profile settings, and distribute MPL-2.0 attribution/license notices. Prefer an adapter to the existing fetch implementation over a duplicate fetch dependency.
- Use OS-backed Electron safeStorage for persisted integration secrets, with no plaintext fallback. Do not introduce keytar or implement a password vault. Pairing grants can remain short lived in memory; secrets must not be committed.
- Add Secretlint and its recommended/1Password rules to source, fixture, log, and release-text checks. Sanitized output must not print matched secret values. Add DOMPurify only if untrusted HTML/SVG is actually rendered; React text and isolated browsing contents do not need an additional HTML parser.
- Existing ExtensionHost remains authoritative. No identity spoofing, native-messaging bypass, or unverified electron-chrome-extensions dependency.

## Initial verification observations

- Desktop TypeScript and 70 unit tests passed before parallel implementation.
- Existing PR #8 build check did not start: GitHub reports the account is locked due to a billing issue. This blocks the protected CI gate independently of code changes.
- Root validation currently reports broad lint/format failures, including existing desktop code and concurrent work. Do not bypass the gate or bulk-edit protected BeUI internals to manufacture a pass; audit authored versus upstream code separately.
- Native integration owner is Anscombe; shell owner is Mendel. Orchestrator owns release/CI verification tooling and this ledger, not competing product implementations.

## Current verification ledger (2026-09-13)

- Direct TypeScript compilation passed.
- The desktop unit suite passed **108/108** tests, including profiles, migration,
  control ownership, authentication fail-closed behavior, extension lifecycle,
  layout/reveal geometry, address safety, and sidebar drag capacity.
- The production `electron-vite` build passed and emits the Zenmium favicon
  derivatives alongside the renderer.
- Native Chromium harness: **36/36 attempted, 0 failures, 2 unavailable**;
  unavailable cases require trusted native focus that a hidden host cannot
  provide (Alt-click Glance and an unfocused split pane).
- Live browser UI verifier: **14 flows passed**; CDP-only native focus
  limitations are recorded separately in its proof output.
- Secret scans passed with **0 findings** in 330 source text files and 15 build
  text files.
- A local macOS `Zenmium.app` bundle was produced, distribution-signed, and
  verified on disk. Its bundle name, `com.zenmium.desktop` identifier, HTTP/
  HTTPS URL registrations, app icon, ASAR integrity, and required Electron
  fuses were verified. Notarization was skipped because credentials/options are
  not configured.
- The genuine 1Password provider is not connected in this environment; the
  authentication broker remains explicitly unavailable rather than claiming a
  fill or TOTP success. PR/merge/publish gates therefore remain closed.
