# S005 - Helium base

## Track T2 - Zenmium chrome UI: liquid-glass frame and sidebar

## Problem And Solution

- **Original Problem**: Zenmium's identity — minimal liquid-glass frame and Zen-style sidebar — currently lives in an Electron/React shell that dies with the Electron base.
- **Solution**: The design system re-expressed as patches on the Helium clone's Chromium UI surfaces (native Views chrome + WebUI pages), with Helium's own vertical-tabs/split-view/layout infrastructure as the substrate.
- **Outcome Objective**: Deliver the Zenmium chrome so the operator sees the accepted liquid-glass frame and sidebar on the Helium base; this track owner is responsible for behavior, controls, validation, and design proof.
- **Linear Review Source**: none (Cabinet + `PROJECT-STATE.md` govern)

## Context

TP's directive: "install Helium and put our design touches on top" — keep the liquid-glass frame and sidebar menu, **do not port the initial greeting animation**. Helium already ships vertical tabs, split view, tab groups, four layout options, color themes, and a Frameless mode — the port rides those seams rather than rebuilding tab management. Design canon lives in this repo:

- `docs/zenmium/DESIGN_SYSTEM.md` — pre-canonical system: shadcn `oklch` CSS variables, flat colors (no gradients/glow/blur — the liquid-glass intent is *minimal*, per TP), `--radius: 0.625rem`, Inter, Phosphor icons only, 44px touch targets, motion 120–320ms decelerating into rest, reduced-motion = instant.
- `docs/zenmium/ZEN_SIDEBAR_SPEC.md` — reverse-engineered Zen `1.22b` sidebar: DOM order, compact mode (`zen.view.compact.enable-at-startup=true` equivalent behavior), workspaces, pinned tabs, hover/compact rules.
- `docs/zenmium/ZEN_FRONTEND_PARITY.md`, `ZEN_FRONTEND_REFERENCE.md` — parity checklists and reference captures.
- `docs/zenmium/design/clypr-wonder/` — exported Wonder reference assets (reference only, not runtime proof).
- `design/banks/` — `beui.md`, `shadcn-cssinjs.md` (component anatomy sources).

Upstream surfaces (verified live 2026-09-22): `imputnet/helium` tag `0.17.2` `patches/` + `resources/`; `imputnet/helium-prism` main `e73a15554e29` (Svelte shared UI components for Helium's web interfaces — the WebUI component layer); `imputnet/helium-onboarding` main `88e1b012b48f` — the first-run greeting component, **excluded by TP directive**, not vendored.

Installation Foundation (recorded per CAO): BeUI Pro / BeUI — `not applicable` to native Views patches; eligible consumer is the agent-rail WebUI surface (T3 builds it, T2 supplies the tokens/seam). Motionary.dev / ascertainty — `not applicable` at patch level; motion canon is 120–320ms decelerating with reduced-motion instant. Bklit / EvilCharts — `not applicable` (no data-viz surface in chrome UI).

## Solvys Coding-Agent Contract

- Follow `SOLVYS_AGENT_SYSTEM_PROMPT.md`.
- For frontend/UI work, read `Design.md` (shared canon) and `docs/zenmium/DESIGN_SYSTEM.md` immediately before planning; re-check the patch against both before landing.
- Keep visible UI canon stable — the spec files above are the canon; do not redesign.
- Prove through the highest reality available: rendered screenshots from the CI-built browser at named window sizes.

## Linear Scope

- **Issue naming**: `S005 - Helium base / T2 - Zenmium chrome UI`
- **Beta Phase**: Pre-Release
- **Linear Project**: not available
- **Due date**: 2026-09-26
- **Assigned owner**: Codex Cloud

## Branch Target

`2026-09-22` — branched after T1's vendored tree lands (checkpoint dependency below).

## Cloud Pickup

- **Sprint identity**: `S005 - Helium base`
- **Accepted plan revision**: `sprint-md/S005-ORCHESTRATION.md` rev 1
- **Environment type**: repository-backed Codex Cloud
- **Repository slug**: `nicharacci/zenmium`
- **Base commit**: T1 checkpoint `refs/sprints/S005/T1/P1` (tree must exist before patch authoring)
- **Date integration branch**: `2026-09-22`
- **Task-owned checkpoint ref**: `refs/sprints/S005/T2/P1`
- **Checkout mode**: detached task-owned worktree
- **Protected zones**: `desktop/**`, `browser/patches/series` (append section only — series merge order owned by unification), canonical logo, secrets
- **Dependencies**: T1 complete (vendored tree + SERIES.md convention)
- **Secrets manifest (names only)**: none
- **Proof gates**: `git apply --check` green on the full series; CI build compiles; screenshot proof of sidebar + frame from the built artifact
- **Return path**: pushed branch + checkpoint ref + CI run + screenshots
- **Closure condition**: patches apply and render, or named Chromium-surface blocker recorded

## User Testing Inheritance

- **Parent client objective**: operator recognizes Zenmium, not Helium, at first window
- **Inherited acceptance criteria**: sidebar per `ZEN_SIDEBAR_SPEC.md` DOM order and compact behavior; liquid-glass frame; **no greeting animation or onboarding flow on first launch**
- **Test-data boundary**: no real profiles
- **Approval posture**: full for patch authoring
- **Acceptance branch**: `2026-09-22`

## Scope -- Included

- [ ] `browser/patches/zenmium/ui-sidebar-*.patch` — Zenmium sidebar per `ZEN_SIDEBAR_SPEC.md`: workspaces (Spaces), pinned + today tabs, folders, overflow, compact mode. Prefer building on Helium's existing vertical-tab/layout code paths; record the seam used.
- [ ] `browser/patches/zenmium/ui-frame-*.patch` — liquid-glass window frame: macOS vibrancy/material surface per "minimal intent" (flat-tinted translucency consistent with the no-glow/no-blur token law); Windows gets the matching flat frame treatment.
- [ ] `browser/patches/zenmium/ui-theme-*.patch` — Zenmium token mapping into Chromium theme colors (oklch → the color pipeline Helium/Chromium exposes); NTP background and toolbar tint.
- [ ] `browser/resources/zenmium/` — WebUI assets (sidebar-related chrome pages, settings skin) authored as WebUI/prism-style Svelte components where Helium exposes them; Phosphor icon assets for Zenmium-owned surfaces.
- [ ] `browser/patches/zenmium/ui-onboarding-remove.patch` — disable/strip `helium-onboarding` first-run greeting and any Helium welcome flow; first launch lands directly in the browser window. The Electron `GoalpostOnboarding` animation does not port — record its death in the contract doc.
- [ ] Compact-mode and keyboard behavior parity notes appended to `docs/zenmium/S005-HELIUM-BASE.md` (owned file — append section only).

## Scope -- Excluded (DO NOT TOUCH)

- `desktop/**` — frozen Electron lane.
- `browser/patches/series` top-level ordering — write patches + record intended position in `patches/zenmium/SERIES.md`; unification merges the series file.
- Internal-products contract, native messaging, agent dock — T3.
- Service endpoints/flags — T4 (T2 may consume T4's hostnames as documented placeholders).
- Helium's *existing* native features (bangs UI, split view, tab groups) — keep default-on; do not reskin beyond token mapping.

## Frontend Gate

- Design canon loaded: `docs/zenmium/DESIGN_SYSTEM.md` + `ZEN_SIDEBAR_SPEC.md` + shared `Design.md` — required reading before the first patch.
- TP owns palette/effects/polish; this track maps the accepted canon, it does not invent new tokens.
- ChatGPT Site: not applicable — native-app UI. Proof = built-artifact screenshots at 1440x900 and 1280x800 windows, light/dark, compact on/off.

## Execution And Storage Lane

- **Execution lane**: Codex Cloud authoring; CI compile via T1's workflows. Local lane closed (1.1 GB free, 2026-09-22).
- **Workspace path or Cloud branch**: `2026-09-22`
- **Estimated peak storage**: worktree ~2 GB; CI runner ~120–160 GB ephemeral
- **Exit condition**: rendered proof or recorded blocker
- **Closure state**: active

## Reuse Inventory (existing code to call, not reinvent)

- `ZEN_SIDEBAR_SPEC.md` DOM order — the literal element list the patch reproduces
- Helium vertical-tabs / split-view / layout patches in `browser/patches/` — the substrate to extend
- `imputnet/helium-prism` components — vendored into `browser/resources/zenmium/prism/` if WebUI surfaces need shared controls
- `design/banks/beui.md`, `design/banks/shadcn-cssinjs.md` — component anatomy for any Zenmium-owned WebUI control

## Known Issues to Preserve

- Helium's layout options, Frameless mode, and theme system stay user-facing; Zenmium skin maps onto them rather than replacing them.
- The greeting/onboarding removal is deliberate and recorded — not a missing feature.

## Implementation Steps

1. Read `ZEN_SIDEBAR_SPEC.md` + `DESIGN_SYSTEM.md`; produce a seam map (which Helium/Chromium UI surface hosts each Zenmium element) and record it in the patch series README.
2. Vendor `helium-prism` subset needed for WebUI surfaces into `browser/resources/zenmium/prism/` with provenance.
3. Author sidebar patch series → `git apply --check` → CI compile.
4. Author frame + theme patch series → compile → screenshot gate (light/dark, compact on/off).
5. Author onboarding-removal patch; verify first-launch lands in the browser window with no greeting.
6. Land checkpoint `refs/sprints/S005/T2/P1`.

## Acceptance Criteria

- [ ] Sidebar reproduces the `ZEN_SIDEBAR_SPEC.md` DOM order and compact-mode behavior on the built browser.
- [ ] Liquid-glass frame renders on macOS; flat equivalent on Windows; no glow/gradient violations of the token law.
- [ ] First launch shows no greeting animation or onboarding flow.
- [ ] All patches pass `git apply --check`; CI build compiles; screenshots attached to the checkpoint.
- [ ] `desktop/**` untouched.

## Validation Commands

```bash
cd browser && git apply --check --directory=src $(cat patches/series | grep -v '^#')
# Compile + screenshot via T1 CI workflows (macos + windows)
```

## Commit Format

```
S005 - Helium base / T2

Outcome: ...
Principal areas: browser/patches/zenmium/ui-*, browser/resources/zenmium/
Proof: CI run URL + screenshot set
Protected zones: desktop/**, canonical logo, series merge order
Remaining blocker: ...
```
