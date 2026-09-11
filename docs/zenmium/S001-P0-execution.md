# S001-P0 — Scaffold the Electron app and build it

Status: building. Owner: `solvys-developer-1` with `solvys-developer-2`. Reviewer: supervisor on the pushed commit. Parent: `docs/zenmium/PLAN.md`.

## Original problem

Zenmium has no runnable shell. Nothing downstream can be built or tested until the Electron app compiles, opens a real Chromium tab through `BrowserCore`, and installs an extension through the store flow.

## Outcome

A buildable Electron app in `desktop/` that CI compiles on macOS, opens one window with the BeUI chrome, loads a real tab through `BrowserCore`, and has the extension host, store install pipeline, and agent kernel wired.

## Exact paths

```text
desktop/
  package.json  tsconfig.json  electron.vite.config.ts  components.json
  src/shared/ipc.ts
  src/main/index.ts  security.ts  browser-core.ts  extension-host.ts  store-install.ts  agent-kernel.ts
  src/preload/index.ts
  src/renderer/index.html  main.tsx  App.tsx  tailwind.css  global.d.ts
  src/renderer/components/Sidebar.tsx  AgentRail.tsx  TabStrip.tsx  AddressBar.tsx  StoreInstall.tsx
docs/zenmium/STORE-INSTALL.md
.github/workflows/desktop.yml
```

## Batches

- B1 Contract. `src/shared/ipc.ts`, preload bridge, security policy.
- B2 Browser core. `BrowserCore` seam with the Electron `WebContentsView` adapter; tabs, navigation, bounds.
- B3 Chrome. Sidebar, tab strip, address bar, collapsible agent rail.
- B4 Extensions and agent. Extension host, store install pipeline, OpenCode kernel, IPC wiring in `src/main/index.ts`.
- B5 CI. macOS workflow runs `pnpm install`, `pnpm typecheck`, `pnpm build`.

## Acceptance checks

- Given the repo, when CI runs, then typecheck and build pass on macOS.
- Given the built app, when it launches, then one window opens with the sidebar, tab strip, and address bar, and the renderer has no Node access.
- Given the app, when a URL is entered, then a Chromium tab loads and back, forward, and reload work through `BrowserCore`.
- Given a Chrome Web Store id, when the install button runs, then the CRX is resolved, verified, extracted, and loaded, and it survives a restart.
- Given the app, when it quits, then it exits cleanly and the agent process stops.

## Proof rungs

Source (pushed), CI build (workflow green), installed app (operator launches the packaged bundle), and a baseline interaction recording. Highest rung for this tranche: installed app.

## Protected zones

- `BrowserCore` is the only Chromium boundary. No renderer imports Electron.
- No keys in the renderer. Names only.
- One agent loop (OpenCode). No second chat engine.

## Rollback

Revert the tranche commit. The extension registry under `userData/zenmium/` is product data and is not removed by a revert.

## Risk register

- ESM preload under sandbox. The renderer preload is ESM, so `sandbox` is off and `contextIsolation` stays on; revisit if Electron tightens this.
- Electron extension subset. MV3 service workers and native messaging are out; ticket ZEN-002 tracks the matrix and the password-manager and ad-blocker cases.
- OpenCode route drift. Routes are centralized in `agent-kernel.ts`; confirm against the pinned build.
- Store CRX flow. No Google signature root is pinned in v1; the docs and UI must not claim cryptographic provenance.

## Secrets manifest

Names only: `OPENROUTER_API_KEY`, `BEUI_PRO_TOKEN`. Values live in 1Password and are used through the browser extension in Zen. See `docs/zenmium/SECRETS.md`.
