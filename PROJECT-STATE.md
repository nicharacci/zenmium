---
version: 1
projectId: zenmium
stateRevision: 1
activeSprint: S001
sourceRef: main
sourceCommit: unset
authorityEnvironment: goalpost-code
syncStatus: unverified
---

# Project state

One Git-tracked truth file. Chat is not the source of truth. No secrets.

## Current intent

Build Zenmium, a standalone macOS browser: a Chromium content core behind a `BrowserCore` seam, a web-technology chrome wrapped in BeUI, and one Arc-style sidebar whose bottom half is a collapsible agent rail running an embedded OpenCode kernel. Product spec lives in `docs/zenmium/`. Decisions, phases, acceptance checks, and the competitive rubric are in `docs/zenmium/PLAN.md`.

## Protected zones

- Do not commit `.env`, cookie jars, Browser Profiles, or any secret value.
- Secrets, data-store credentials, and keys come from 1Password: `op` locally, or the 1Password extension in Zen for web sign-in. Names in context, values never. See `docs/zenmium/SECRETS.md`.
- Never place `BEUI_PRO_TOKEN`, `OPENROUTER_API_KEY`, or any key in git.
- The agent kernel and the provider gateway are single-owner. No second agent loop, no keys in renderers.
- `main` stays clean and deployable; work arrives through dated integration branches and reviewed draft PRs.

## Next safe action

Review and merge the Zenmium spec in `docs/zenmium/` and the BeUI design bank in `design/banks/beui.md`. Then open the first work item: scaffold the Electron shell monorepo per `docs/zenmium/PLAN.md` phase P0.
