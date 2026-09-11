# S001 — Stand up Zenmium to a competitive v1

Status: planned. Owner: poteto-agent-1 (implementer) with poteto-agent-2 (agent and security), reviewer on the pushed branch. This plan is the contract; a changed requirement revises it before work continues.

## Outcome

Deliver Zenmium so the operator can install and drive a macOS browser built on Mori's engine with a BeUI web chrome, an Arc-style sidebar, Chrome-class extension and app-window behavior, and an embedded agent in the sidebar bottom half, then grade it against Zen and Arc.

## Contract

- Execution lane: repository-backed Cloud task on a Cloud macOS runner for the engine build, and standard CI for the web chrome. Planning stays local.
- Owner and protected zones: see `ARCHITECTURE.md`. The engine, the bridge, and the agent kernel are protected. No second agent loop. No keys in the web chrome.
- Highest requested proof rung: an installed application on the operator's Mac, plus human acceptance. Typecheck, build, and preview are required stops on the way.
- Secrets manifest (names only): `OPENROUTER_API_KEY`, `BEUI_PRO_TOKEN`. Values live in 1Password and are used through the browser extension in Zen.
- Dependencies to confirm before dispatch: the product fork home, and the AppKit host choice.

## Competitive rubric (100 points)

| Dimension | Points | Zen baseline | Arc baseline | Zenmium v1 target |
| --- | --- | --- | --- | --- |
| Engine and web standards | 15 | 13 | 14 | 14 |
| Chrome extension parity | 15 | 4 | 14 | 11 |
| Installable web apps | 5 | 2 | 5 | 4 |
| Security and update cadence | 15 | 13 | 12 | 12 |
| Privacy and isolation | 10 | 9 | 8 | 8 |
| Sidebar and tab UX | 15 | 11 | 15 | 14 |
| Customization and themes | 10 | 7 | 10 | 8 |
| Agent integration | 15 | 0 | 4 | 14 |
| **Total** | **100** | **59** | **82** | **85** |

Scores are planning estimates from documented behavior, not benchmarks. The engine and sidebar columns start higher than a from-scratch shell because Mori already ships them; the extension column starts higher because the engine is Chromium with a native extension bridge.

## Phases

### P0 — Fork and baseline

- Fork `FujiwaraChoki/mori-browser` into the product repo.
- Reproduce Mori's GN/ninja ungoogled-chromium build on a Cloud macOS runner and package `Zenmium.app`.
- Run the app, exercise spaces, folders, tabs, extensions, and the AI panel, and record the baseline behavior.
- Map the three workstreams to source files: the chat rail (`AIPanel.swift`, `CodexAppServerClient.swift`, `Sidebar.swift`), references (`BookmarkStore.swift`, `TabFolder.swift`, `Contexts.swift`), and extensions (`mori_chrome_extensions.mm`, `ExtensionStore.swift`).

Acceptance: a packaged `Zenmium.app` builds from the fork on the Cloud runner, launches, and a source map places every workstream file.

### P1 — Web chrome shell

- Add the AppKit host and the web surface that replaces Mori's SwiftUI chrome.
- Build the Arc sidebar top half, tab strip, address bar, and command bar in BeUI.
- Wire the typed IPC bridge to Mori's Objective-C++ layer for tab lifecycle, navigation, spaces, folders, and downloads.
- Restyle to the Goalpost or BeUI register; keep every control real.

Acceptance: open real sites, switch spaces, create and reorder folders, pin and archive tabs, all from the web chrome.

### P2 — Agent rail

- Collapsible bottom half of the sidebar with a right-aligned caret carrying state.
- BeUI Chat App for messages, streaming, tools, approvals, diffs, and prompt input.
- Replace the Codex-bound panel with the OpenCode kernel over localhost; sessions and turns are the only writer of turns.

Acceptance: a prompt streams into the rail; a tool approval is required before any page action; collapsing preserves the session.

### P3 — References

- Reference registry over Mori's bookmark, folder, context, and history stores.
- Bookmarks UI, folder tree, local filetree, and `@` tags in the composer.
- Situation dump surfaced to the agent on first turn.

Acceptance: tagging a bookmark, a folder, and a local file produces three addressable ids the agent can read and act on.

### P4 — Extension parity, security, polish

- Extension compat matrix, Web Store install path, post-update re-enable, Widevine and MV2 decisions.
- Security package: egress allowlist, permission handlers, injection defenses, dependency and secret scanning, SBOM, and the engine rebuild pipeline.
- Visual polish and reduced-motion and focus states.

Acceptance: 80-90 rubric score, extension matrix published, security checks green, installed build passes human acceptance.

## Batch boundaries and rollback

- One phase per checkpoint; push `refs/sprints/S001/P#` before the next phase.
- Each phase is reversible by reverting its checkpoint. The engine fork and the web chrome are separate trees, so a chrome revert does not touch the engine.
- `main` stays protected. Integration happens on a dated branch by the reviewer.
- If replacing Mori's SwiftUI chrome cannot be done without disturbing the GN target list, stop and revise this plan before P1 continues.

## Return path

Every phase returns to the reviewer with the exact commit or ref, the proof rung reached, protected zones touched, the installed-app artifact, and human-acceptance notes. The reviewer owns acceptance; the daily integrator owns the merge.
