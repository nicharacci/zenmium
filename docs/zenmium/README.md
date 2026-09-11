# Zenmium

Status: building. Base: Electron (bundled Chromium) with a fully web chrome. Repo: `nicharacci/zenmium`. App: `desktop/`.

## Original problem

The operator wants one internal browser that browses like Zen, is navigated like Arc, runs Chrome extensions and installable web apps, and carries a first-class agent in the same sidebar. Zen runs on Gecko, so Chrome extensions and installable apps fail. Arc is closed. Building a Chromium chrome from source costs a hundred-gigabyte build. Electron gives the same Chromium engine with minutes-long builds and a chrome that BeUI can style end to end.

## Named solution

Zenmium is an Electron browser. Real Chromium content through one `WebContentsView` per tab behind a `BrowserCore` seam. The entire chrome is React 19, Tailwind v4, and BeUI / BeUI Pro. One Arc-style sidebar: browser navigation on top, a collapsible agent rail on the bottom. An embedded OpenCode kernel. A wrapped Chrome Web Store install flow that sideloads extensions through an automated, persisted pipeline.

## The three workstreams

1. Chat rail. BeUI Chat App in the collapsible bottom half of the shared sidebar, driven by the OpenCode kernel, with a right-aligned caret carrying state.
2. Folders, filetrees, bookmarks, `@` tags. An addressable Reference registry over the product's own bookmark and file stores so the agent can be pointed at an object by tag.
3. Chrome extension parity. A wrapped store install flow plus the unpacked extension host, with an honest compat matrix.

## Decisions recorded

| ID | Decision | Choice |
| --- | --- | --- |
| D1 | Shell | Electron (bundled Chromium) |
| D2 | Product UI | React 19, Tailwind v4, BeUI, BeUI Pro for the entire chrome |
| D3 | Content | `WebContentsView` per tab behind a `BrowserCore` seam |
| D4 | Sidebar | One Arc-style sidebar: browser nav on top, collapsible agent rail on the bottom |
| D5 | Agent runtime | OpenCode (`opencode serve` plus `@opencode-ai/sdk`) |
| D6 | Model gateway | OpenRouter; default `deepseek/deepseek-v4.1-flash` |
| D7 | Extensions | Unpacked host plus a wrapped Chrome Web Store install flow |
| D8 | References | Product-owned registry over own bookmarks and files |
| D9 | Build | GitHub-hosted macOS runners; `electron-vite` build |
| D10 | Scope v1 | macOS first |
| D11 | Dropped | From-source Chromium chrome (Mori), Panel UI |

## Repo layout

```text
desktop/                       Electron app
  src/main/                    main process: window, security, browser-core, extension host, store install, agent kernel
  src/preload/                 typed context bridge
  src/renderer/                React chrome: sidebar, tab strip, address bar, agent rail
  src/shared/                  IPC contract shared by main and renderer
docs/zenmium/                  product spec
.github/workflows/             CI
```

## Docs map

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — layers, ownership, the extension model, the store install flow, security, stack.
- [`PLAN.md`](PLAN.md) — S001 phases, acceptance checks, proof rungs, competitive rubric.
- [`ISSUES.md`](ISSUES.md) — ticket slate with fixes and provenance.
- [`STORE-INSTALL.md`](STORE-INSTALL.md) — the wrapped store install flow.
- [`AGENT_ERGONOMICS.md`](AGENT_ERGONOMICS.md) — the addressable agent tower and Reference object.
- [`SECRETS.md`](SECRETS.md) — the 1Password browser-extension lane.
- [`S001-P0-execution.md`](S001-P0-execution.md) — the first executable tranche.

## Secret handling

All secrets, data-store credentials, and keys use the 1Password browser extension in Zen. No CLI. Config and docs record names only: `OPENROUTER_API_KEY`, `BEUI_PRO_TOKEN`. See [`SECRETS.md`](SECRETS.md).

## Provenance

- Electron extension support matrix: official Electron docs.
- OpenCode kernel: `opencode.ai/docs` (server, SDK, MCP, ACP), MIT.
- BeUI: `github.com/starc007/ui-components` (MIT), `beui.dev`; BeUI Pro: `pro.beui.dev`.
- Community complaints and fixes: the `r/ArcBrowser` Mori thread, Mori issues, and the derived `redclayai/millie` PR history.
