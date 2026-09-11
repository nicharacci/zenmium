# S001-P0 — Fork Mori and baseline the build

Status: planned. Owner: poteto-agent-1 (implementer). Reviewer: supervisor on the pushed branch. Parent spec: `docs/zenmium/PLAN.md` (S001), `docs/zenmium/ARCHITECTURE.md`.

## Original problem

Zenmium is defined as Mori's engine and bridge wearing a BeUI web chrome, but no fork exists, the Chromium build has never been reproduced outside the author's machine, and the three workstreams have not been mapped to source. Nothing downstream can start until the fork builds and the app runs.

## Outcome

Deliver a packaged `Zenmium.app` built from the Mori fork on a Cloud macOS runner, launched and exercised, with a source map that places the chat rail, the reference stores, and the extension path.

## Prerequisites (human and host, separate from this tranche)

1. Fork `FujiwaraChoki/mori-browser` into the product repo. Confirm the fork home before dispatch.
2. Provision a Cloud macOS build host with at least 100 GB free, Xcode, depot_tools, and 16 GB of RAM or more. GitHub-hosted macOS runners are too small and time-capped for a Chromium build, so use MacStadium or an AWS EC2 Mac host.
3. No local build. Local capacity is Critical and the Chromium checkout is tens of GB.

## Exact paths (Mori upstream, for reference)

```text
ungoogled-chromium-macos/build/src/chrome/browser/ui/mori/
  MoriRoot.swift
  RootView.swift
  Sidebar.swift
  Toolbar.swift
  TabRow.swift
  LauncherOverlay.swift
  BrowserStore.swift
  BrowserTab.swift
  Contexts.swift
  TabFolder.swift
  BookmarkStore.swift
  ExtensionStore.swift
  HistoryStore.swift
  ArchiveStore.swift
  AIPanel.swift
  CodexAppServerClient.swift
  BrowserAutomation.swift
  ShortcutRegistry.swift
  mori_chrome_bridge.mm
  mori_browser_window.mm
  mori_chrome_extensions.mm
  mori_permission_prompt.mm
ungoogled-chromium-macos/build/src/chrome/browser/ui/BUILD.gn
```

## Batches

- B1 Fork and pin. Fork the repo, record the upstream commit, and add `AGENTS.md` and `PROJECT-STATE.md` continuity notes. Check: the fork exists and the commit is recorded.
- B2 Reproduce the build. On the Cloud macOS host, place depot_tools and binshims on `PATH`, set `DEVELOPER_DIR`, and run `ninja -j 16 -l 24 -C out/Default chrome`. Check: ninja exits 0 and produces `out/Default/Mori.app`.
- B3 Package and launch. Package with `ditto` to `Zenmium.app` and launch it with an isolated `--user-data-dir`. Check: the app opens, opens a page, and quits cleanly.
- B4 Baseline and map. Exercise spaces, folders, tabs, extensions, and the AI panel. Produce a source map that names the files for the chat rail, references, and extensions. Check: the map covers every workstream entry point.

## Acceptance checks

- Given the fork, when the Cloud host runs the build, then ninja exits 0 and produces the app bundle.
- Given the packaged app, when it launches on macOS, then a page loads and the app quits without a crash.
- Given the running app, when the operator uses spaces, folders, tabs, and an installed extension, then the baseline behavior is recorded.
- Given the source tree, when reviewed, then the three workstreams each have a named entry point and the GN target list is understood.

## Proof rungs

Source (fork pushed), build (ninja exit 0 on the Cloud host), installed app (operator launches the packaged bundle), and a baseline interaction recording. The highest rung for this tranche is the installed app.

## Protected zones

- Mori's `ungoogled-chromium-macos` checkout and `BUILD.gn` target list. Do not move Swift files or rename targets in this tranche.
- No `rm -rf`. Use `trash` when replacing app bundles or build directories.
- Secrets. `OPENROUTER_API_KEY` and `BEUI_PRO_TOKEN` are names only. Values live in 1Password and are used through the browser extension in Zen.

## Rollback

This tranche is a fork plus a build. Discard the fork or reset to the pinned upstream commit to revert. Nothing in this tranche mutates the engine.

## Return path

Push the fork and the baseline notes, then hand to the reviewer with the build log, the packaged artifact location, and the source map.

## Risk register

- Chromium build cost. Tens of GB and hours, RAM-sensitive. Mitigation: MacStadium or EC2 Mac with 16 GB or more, and a reduced `-j` if RAM pressure appears.
- Stale binaries. Reusing a running process can load an old framework. Mitigation: launch with `open -n` and an isolated `--user-data-dir`.
- Undocumented Codex dependency. The upstream app can crash on launch without Codex. Mitigation: record the behavior; the agent rail replaces this in P2.
- GN target list. Swift files are listed explicitly in `BUILD.gn`; moves must update it. Mitigation: no moves in this tranche.

## Secrets manifest

Names only: `OPENROUTER_API_KEY`, `BEUI_PRO_TOKEN`. Values live in 1Password and are used through the browser extension in Zen. No values in this plan, the repo, config, or logs. See `docs/zenmium/SECRETS.md`.
