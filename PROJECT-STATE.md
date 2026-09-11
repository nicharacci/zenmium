---
version: 1
projectId: zenmium
stateRevision: 2
activeSprint: S001
sourceRef: main
sourceCommit: unset
authorityEnvironment: goalpost-code
syncStatus: unverified
---

# Project state

One Git-tracked truth file. Chat is not the source of truth. No secrets.

## Current intent

Build Zenmium as an Electron browser: real Chromium content through one WebContentsView per tab behind a `BrowserCore` seam, a chrome built entirely from BeUI and BeUI Pro, one Arc-style sidebar with browser navigation on top and a collapsible agent rail on the bottom, an embedded OpenCode kernel, an addressable Reference registry, and Chrome extension parity through a wrapped Chrome Web Store install flow. App source lives in `desktop/`. Spec lives in `docs/zenmium/`.

## Protected zones

- Do not commit `.env`, cookie jars, Browser Profiles, or any secret value.
- Secrets, data-store credentials, and keys come from the 1Password browser extension in Zen. Names in context, values never. No 1Password CLI. See `docs/zenmium/SECRETS.md`.
- `BrowserCore` is the only Chromium boundary; no renderer imports Electron or touches Chromium.
- One agent loop (OpenCode). No second chat engine.
- `main` stays clean and deployable. Work lands on `main` directly.

## Next safe action

Run the CI workflow in `.github/workflows/desktop.yml` on macOS. Fix any typecheck or build failure until green, then package and install on the operator's Mac for the installed-app proof.
