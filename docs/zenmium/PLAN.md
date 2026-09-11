# S001 — Stand up Zenmium to a competitive v1

Status: **planned**. Owner: Developer 1 (shell/core) with Developer 2 (agent/security), reviewer on
the pushed branch. This plan is the contract; a changed requirement revises it before work continues.

## Outcome

Deliver Zenmium so the operator can install and drive a standalone macOS browser with Arc-style
navigation, Chrome-class extension/app-window behavior, and an embedded agent in the shared
sidebar, then grade it against Zen and Arc.

## Contract

- Execution lane: repository-backed Cloud task on a Cloud macOS runner. Planning stays local (this workspace).
- Owner and protected zones: see `ARCHITECTURE.md`. The agent kernel and the provider gateway are protected; no second agent loop, no keys in renderers.
- Highest requested proof rung: **installed application** on the operator's Mac, plus human acceptance. Lower rungs (typecheck, build, preview) are required stops on the way.
- Secrets manifest (names only): `OPENROUTER_API_KEY`, `BEUI_PRO_TOKEN`. Values live only in the Workspace Vault.
- Dependencies to confirm before dispatch: repo home, BeUI Pro token, and the D1 shell confirmation (see `README.md`).

## Competitive rubric (100 points)

| Dimension | Points | Zen baseline | Arc baseline | Zenmium v1 target |
| --- | --- | --- | --- | --- |
| Engine and web standards | 15 | 13 | 14 | 13 |
| Chrome extension parity | 15 | 4 | 14 | 9 |
| Installable web apps | 5 | 2 | 5 | 4 |
| Security and update cadence | 15 | 13 | 12 | 12 |
| Privacy and isolation | 10 | 9 | 8 | 8 |
| Sidebar and tab UX | 15 | 11 | 15 | 13 |
| Customization and themes | 10 | 7 | 10 | 8 |
| Agent integration | 15 | 0 | 4 | 14 |
| **Total** | **100** | **59** | **82** | **81** |

Scores are planning estimates from documented behavior, not benchmarks. The agent-integration
column is where Zenmium wins outright; the extension column is where it concedes and must be
documented honestly.

## Phases

### P0 — Foundation (no product UI yet)

- Create the monorepo (pnpm + Turborepo): `apps/desktop`, `packages/ui`, `packages/browser`,
  `packages/agent`, `packages/references`, `packages/security`, `packages/config`.
- Add CI on GitHub-hosted ARM64 macOS runners; cache pnpm.
- Install BeUI; place `BEUI_PRO_TOKEN` in the vault if Pro is approved; register the private registry.
- Prove the OpenCode kernel headlessly: start `opencode serve`, create a session, send a prompt,
  receive a streamed answer through `@opencode-ai/sdk`.

Acceptance: CI is green; `opencode serve` responds to `global.health`; one prompt round-trips
through OpenRouter with `deepseek/deepseek-v4.1-flash`.

### P1 — Shell and browser core

- Electron main process with hardened defaults (`contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP).
- `BrowserCore` seam with the `electron-chromium` adapter; each tab is a `WebContentsView`.
- Arc-style sidebar: spaces, pinned and today sections, folders, tab rows, overflow controls.
- Address bar, command bar (`Cmd+T`), back/forward/reload, find-in-page.
- Arc keyboard map (see `ISSUES.md` ZEN-023).

Acceptance: open real sites, switch spaces, create and reorder folders, pin and archive tabs,
all from the keyboard. Proof: installed build plus a recorded interaction pass.

### P2 — Agent rail sharing the sidebar

- Bottom collapsible rail with a right-aligned caret carrying state (idle, working, blocked, done).
- BeUI Chat App block for messages, streaming, tools, approvals, diffs, and prompt input.
- Rail talks to OpenCode via the typed SDK; sessions and turns are the only writer of turns.
- `@`-mentions route to Goalems/personas and to Reference objects.

Acceptance: a prompt streams into the rail; a tool approval is required before any page action;
collapsing the rail preserves the session.

### P3 — References and agent ergonomics

- `Reference` registry: `ref:bookmark/*`, `ref:url/*`, `ref:file/*`, `ref:doc/*`, `ref:node/*`.
- Bookmarks UI, folder tree, and a local filetree; drag a bookmark or file onto the composer to tag it.
- Situation dump surfaced to the agent on first turn.

Acceptance: tagging a bookmark, a folder, and a local file produces three addressable ids the agent
can read and act on, with proof written to the same ids.

### P4 — Extensions, app windows, security, polish

- Extension host with the compat matrix; unpacked loader; CRX sideload pipeline; fail-closed unsupported APIs.
- App windows for installable web apps (wonder.so as the acceptance target).
- Security package: egress allowlist, permission handlers, injection defenses, dependency and secret scanning, SBOM.
- Visual polish on the Goalpost/BeUI register; reduced-motion and focus states proven.

Acceptance: 80-90 rubric score, extension compat matrix published, security checks green, installed
build passes human acceptance.

## Batch boundaries and rollback

- One phase per checkpoint; push `refs/sprints/S001/P#` before the next phase.
- Each phase is reversible by reverting its checkpoint; no phase mutates another's protected zone.
- `main` stays protected. Integration happens on a dated branch by the reviewer.
- If the `BrowserCore` seam cannot hold a product behavior without leaking Electron types, stop and
  revise this plan before P2.

## Return path

Every phase returns to the reviewer with: exact commit/ref, proof rung reached, protected zones
touched, installed-app artifact, and the human-acceptance notes. The reviewer owns acceptance; the
daily integrator owns the merge.
