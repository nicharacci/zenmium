# S001 — Build Zenmium in Electron to a competitive v1

Status: building. Owner: `solvys-developer-1` (shell, browser core) with `solvys-developer-2` (agent, extensions, security). Reviewer: supervisor on the pushed commit.

## Outcome

Deliver Zenmium so the operator can install and drive a macOS Electron browser with an Arc-style sidebar, real Chromium tabs, a collapsible agent rail, and Chrome-extension behavior through the wrapped store install flow, then grade it against Zen and Arc.

## Contract

- Execution lane: CI on GitHub-hosted macOS runners for the Electron build; local planning only. Local capacity is Critical.
- Protected zones: `BrowserCore`, the extension host, the store pipeline, and the agent kernel. No second agent loop. No keys in the renderer.
- Highest requested proof rung: an installed app on the operator's Mac plus human acceptance. Typecheck and CI build are required stops.
- Secrets (names only): `OPENROUTER_API_KEY`, `BEUI_PRO_TOKEN`. Values live in 1Password, used through the browser extension in Zen.

## Competitive rubric (100 points)

| Dimension | Points | Zen | Arc | Zenmium v1 target |
| --- | --- | --- | --- | --- |
| Engine and web standards | 15 | 13 | 14 | 14 |
| Chrome extension parity | 15 | 4 | 14 | 9 |
| Installable web apps | 5 | 2 | 5 | 4 |
| Security and update cadence | 15 | 13 | 12 | 12 |
| Privacy and isolation | 10 | 9 | 8 | 8 |
| Sidebar and tab UX | 15 | 11 | 15 | 14 |
| Customization and themes | 10 | 7 | 10 | 8 |
| Agent integration | 15 | 0 | 4 | 14 |
| **Total** | **100** | **59** | **82** | **83** |

Estimates from documented behavior, not benchmarks. Extension parity concedes to Electron's subset; the store install flow recovers store reachability.

## Phases

### P0 — Scaffold and build (this tranche)

- Electron workspace: main, preload, renderer, `BrowserCore`, security, IPC contract.
- Extension host and wrapped store install pipeline.
- OpenCode kernel wrapper.
- CI on macOS: typecheck and build.
- Acceptance: CI green; app launches on macOS; a real tab loads and navigates; a store extension installs and survives restart.

### P1 — Sidebar and navigation

- Arc-style sidebar: spaces, pinned and today tabs, folders, overflow controls.
- Command bar (`Cmd+T`), the documented Arc shortcut map, tab sleep and archive.
- Acceptance: full keyboard navigation over real sites.

### P2 — Agent rail

- BeUI Chat App in the collapsible bottom half; caret carries state.
- Session, streaming, tool approvals, diffs, prompt input through the OpenCode kernel.
- Acceptance: a prompt streams; a page action needs approval; collapsing preserves the session.

### P3 — References

- Reference registry over own bookmarks and files; filetree; `@` tags in the composer; situation dump.
- Acceptance: tagging a bookmark, a folder, and a file yields three addressable ids.

### P4 — Parity, security, polish

- Extension compat matrix and store flow hardening; password-manager and ad-blocker behavior tested.
- Security package, SBOM, scanning, egress allowlist.
- Acceptance: 80-90 rubric, matrix published, security checks green, human acceptance.

## Batch boundaries and rollback

- One phase per checkpoint. Each phase reverts independently; the extension registry is product data and is not deleted by a revert.
- Work lands on `main` directly. The reviewer verifies the pushed commit against the acceptance checks.

## Return path

Each phase returns to the reviewer with the exact commit, the proof rung reached, protected zones touched, the CI run, and human-acceptance notes.
