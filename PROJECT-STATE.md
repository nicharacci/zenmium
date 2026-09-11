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

Build Zenmium from the needed Mori source landed in this repo: keep the ungoogled-chromium engine and the Objective-C++ bridge, replace the SwiftUI chrome with a web chrome built entirely from BeUI and BeUI Pro, add a collapsible agent rail backed by the OpenCode kernel, extend the bookmark and folder stores into an addressable Reference registry, and fix Chrome extension parity. Product spec lives in `docs/zenmium/`. Phases, acceptance checks, and the competitive rubric are in `docs/zenmium/PLAN.md`.

## Protected zones

- Do not commit `.env`, cookie jars, Browser Profiles, or any secret value.
- Secrets, data-store credentials, and keys come from the 1Password browser extension in Zen. Names in context, values never. No 1Password CLI. See `docs/zenmium/SECRETS.md`.
- Never place `BEUI_PRO_TOKEN`, `OPENROUTER_API_KEY`, or any key in git.
- The agent kernel and the provider gateway are single-owner. No second agent loop, no keys in renderers.
- `main` stays clean and deployable. The Mori source lands on `main` in this repo, with no separate fork repository or long-lived branches.

## Next safe action

Run `docs/zenmium/S001-P0-execution.md`: land the needed Mori source in this repo, reproduce the Chromium build on a Cloud macOS runner, package `Zenmium.app`, and map the three workstreams to source.
