# Zenmium

Status: planned. Base source: `FujiwaraChoki/mori-browser` (MIT, macOS, a SwiftUI/AppKit chrome compiled into ungoogled-chromium). The needed Mori source lands inside this repo, `nicharacci/zenmium`: no separate fork, no imported history, no extra branches.

## Original problem

The operator wants one internal browser that browses like Zen, is navigated like Arc, runs Chrome Web Store extensions and installable web apps, and carries a first-class agent in the same sidebar. Zen runs on Gecko, so Chrome extensions do not install and installable web apps such as wonder.so do not behave like apps. Arc is closed and frozen. Mori is the closest open base: a real Chromium engine behind an Arc-style sidebar and spaces, with the extension bridge already present. Mori is young and experimental, its chrome is SwiftUI, and its agent panel is bound to a local Codex app server.

## Named solution

**Zenmium** is Mori's engine and bridge wearing a web chrome. Keep Mori's ungoogled-chromium build and its Objective-C++ bridge. Replace the SwiftUI chrome with a web surface built entirely from BeUI and BeUI Pro. A thin AppKit host presents that surface and hands browser control to the bridge. Replace the Codex-bound AI panel with a collapsible agent rail in the same web chrome, backed by the OpenCode kernel.

Outcome-owned objective: Deliver Zenmium so the operator can browse with real Chrome extension and app-window behavior, drive the agent from the browser sidebar, and receive Chromium security updates on a rebuild cadence. Ownership covers chrome behavior, the agent rail, extension parity, references (bookmarks, folders, files, tags), security, validation, and handoff.

## The three workstreams

These are the user-named tasks and they are the spine of the plan.

1. A better chat rail. The BeUI Chat App block in the web chrome, driven by the OpenCode kernel, occupying the collapsible bottom half of the shared sidebar with a right-aligned caret for state. The top half is browser navigation.
2. Folders, filetrees, bookmarks, and `@` tags. Extend Mori's `BookmarkStore`, `TabFolder`, and `Contexts` into an addressable Reference registry so the agent can be pointed at a bookmark, a link, or a file by tag.
3. Chrome extension parity. Fix the ungoogled-chromium extension path (Web Store install, update re-disable, Widevine, MV2) in the fork only. Every community complaint becomes a ticket.

## Decisions recorded

| ID | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | Base | Land the needed Mori source inside this repo: the ungoogled-chromium build target and the Objective-C++ bridge, extension, and permission glue (MIT). No separate fork, no imported history or branches | One repo, one lineage, and only what the objectives need |
| D2 | Product UI | The entire chrome is a web surface (React 19, Tailwind v4, BeUI, BeUI Pro) | The only way to wrap the whole product in BeUI |
| D3 | Host | A thin AppKit host presents the web surface over Mori's engine; Mori's SwiftUI chrome is replaced | Keeps the engine, swaps the UI layer |
| D4 | Bridge | A typed IPC API over Mori's Objective-C++ bridge for tabs, navigation, extensions, downloads, permissions | Product state stays in the app, not in the UI library |
| D5 | Sidebar | One Arc-style sidebar: top half browser navigation, bottom half collapsible agent rail with a right-aligned caret | One shared surface for browser and agent, as specified |
| D6 | Agent runtime | OpenCode (`opencode serve` + `@opencode-ai/sdk`), MIT | Headless, typed SDK, provider-agnostic, BYO-agent via MCP/ACP/custom tools |
| D7 | Model gateway | OpenRouter; default `deepseek/deepseek-v4.1-flash` | One gateway, many models |
| D8 | Build | Mori's GN/ninja ungoogled-chromium build on a Cloud macOS runner | The Chromium checkout needs tens of GB and hours; local capacity is Critical |
| D9 | Scope v1 | macOS first | Mori is macOS only and that matches the operator's machine |
| D10 | Dropped | Panel UI (React Native) | Cannot wrap a native app and is not in the approved stack |
| D11 | Import scope | Import the engine integration and the persisted browser stores (bookmarks, folders, history, extensions); rebuild every view in BeUI | Only what we need, and the chrome is new |

## Docs map

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — Mori layers, the web chrome, the agent rail, the Reference registry, the extension model, the security model, the stack.
- [`PLAN.md`](PLAN.md) — S001 phased plan, acceptance checks, proof rungs, competitive rubric.
- [`ISSUES.md`](ISSUES.md) — ZEN ticket slate with fixes and provenance, sourced from the Mori community and the Chromium extension path.
- [`AGENT_ERGONOMICS.md`](AGENT_ERGONOMICS.md) — the addressable agent tower, Reference object, `@` tags, bookmarks, filetree.
- [`SECRETS.md`](SECRETS.md) — the 1Password browser-extension lane and the names-only rule.
- [`S001-P0-execution.md`](S001-P0-execution.md) — the first executable tranche.

## Open items

None at this time. The source lands in this repo, and the chrome host is decided in `ARCHITECTURE.md`: a privileged Chromium WebContents.

## Secret handling

The BeUI Pro token was supplied in chat and is treated as exposed. Rotate it and store the new value in 1Password. Every secret, data-store credential, and key uses the same lane: the 1Password browser extension in Zen. No CLI. This project records only the name. Full policy: [`SECRETS.md`](SECRETS.md).

## Provenance

- Mori base: `github.com/FujiwaraChoki/mori-browser` (MIT), its `README.md`, `docs/ARCHITECTURE.md`, `docs/SOURCE_LAYOUT.md`, `BUILDING.md`, and `AGENTS.md`.
- Chromium extension path: ungoogled-chromium behavior and the derived-repo fixes (Web Store `webstorePrivate`, update re-disable, Widevine, MV2).
- OpenCode kernel: `opencode.ai/docs` (server, SDK, MCP, ACP), MIT.
- BeUI: `github.com/starc007/ui-components` (MIT), `beui.dev`; BeUI Pro: `pro.beui.dev`.
- Competitor facts: Mori repo and issues, Zen repo metadata, Arc help center and The Browser Company statements.
