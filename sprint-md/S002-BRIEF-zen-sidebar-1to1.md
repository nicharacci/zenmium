# S002 - Zen sidebar 1:1 parity

## Problem And Solution

- **Original Problem**: The Zenmium sidebar is a hand-built approximation of Zen Browser's. It lacks Zen's real structure, states, and compact-mode behavior, so the browser the operator actually uses daily feels different from the product we are shipping.
- **Solution**: Zen Sidebar Parity — reimplement the Zenmium sidebar as a faithful port of Zen Browser's vertical-tabs sidebar, using Zen's own source (`docs/zenmium/ZEN_SIDEBAR_SPEC.md`) as the design source of truth.
- **Outcome Objective**: Deliver the Zen-parity sidebar so the operator gets Zen's exact sidebar and compact-mode behavior in Zenmium; the sprint owner is responsible for behavior, controls, validation, and design proof.
- **Linear Review Source**: none.

## Intent

When this is done, Zenmium's sidebar is a 1:1 copy of Zen's: the same tab rows, the same docked URL bar, the same essentials grid, the same workspace switcher and indicator, the same collapse and compact-mode hover behavior, and the same tab states and context menu. The operator opens Zenmium and it feels like Zen, not a lookalike.

## Solvys Coding-Agent Contract

- Follow `AGENTS.md` and `SOLVYS_AGENT_SYSTEM_PROMPT.md`.
- The design source of truth is `docs/zenmium/ZEN_SIDEBAR_SPEC.md`, reverse-engineered from Zen Browser's source (MPL-2.0). Where BeUI blocks already cover a surface (command palette, chat rail), keep them.
- Start from repo truth and preserve intentional dirty state.
- Understand the whole app surface touched, not only the sidebar component.
- Keep the Arc model in `src/main/arc-core.ts` as the state authority; the sidebar is its view.
- Prove completion through the highest-reality surface: the built and launched Electron app, verified by screenshot.

## Branch Target

`2026-09-12`

`main` is protected and never the development lane.

## Codex Pickup

- **Sprint identity**: `S002 - Zen sidebar 1:1 parity`
- **Accepted plan revision**: this file, frozen on `Implement this plan`.
- **Execution lane**: Codex. This is a direct user instruction; the OpenCode Cloud identity invariant does not apply.
- **Repository slug**: `nicharacci/zenmium`
- **Base branch**: `main` at the current tip
- **Date integration branch**: `2026-09-12`
- **Checkout mode**: worktree on the date branch
- **Authenticated Git publication route**: `gh` as `nicharacci`, branch push + PR
- **Owner**: the Codex session
- **Protected zones**: `src/main/arc-core.ts` state contract, `src/shared/ipc.ts` channel names, the BeUI block files under `src/renderer/components/motion` and `src/renderer/components/agents`, `tailwind.css` theme tokens
- **Dependencies**: none new; Electron 35, React 19, BeUI blocks, lucide-react already installed
- **Secrets manifest (names only)**: `OPENROUTER_API_KEY`, `BEUI_PRO_TOKEN` (not needed for this sprint)
- **Proof gates**: `tsc --noEmit` clean; `electron-vite build` clean; app launches; CDP screenshot captured and compared to Zen
- **Return path**: push `2026-09-12`, open a PR to `main`, request review
- **Closure condition**: PR merged to `main` after review

## Execution And Storage Lane

- **Execution lane**: local Codex session on this Mac (GitHub Actions is blocked on this account, so CI cannot gate)
- **Workspace path or Cloud branch**: the `desktop/` app; branch `2026-09-12`
- **Estimated peak storage**: under 200 MB (build output only; `node_modules` already installed)
- **Capacity reservation**: local disk is tight (about 8 GB free); do not install new heavy dependencies
- **Exit condition**: PR open with green local proof
- **Closure state**: active

## Scope -- Included

All 25 items from `docs/zenmium/ZEN_SIDEBAR_SPEC.md` section 8:

- [ ] 1. Vertical tab list in a resizable left/right sidebar with measured width; expanded 230px, collapsed 60px rail.
- [ ] 2. Tab rows: 2px block margin, 14px radius, 8px inline padding, 36px height, label and 16px radius-4 favicon.
- [ ] 3. Active tab press scale 0.985 and rotate 0.01deg, selected background and shadow; hover background.
- [ ] 4. Top buttons row: compact toggle, separator, nav buttons, extensions, menu at 36px (macOS 38px).
- [ ] 5. URL bar docked in the sidebar: full width, 48px container, 36px pill, 4px input padding.
- [ ] 6. Essentials grid: auto-fit, 4px gap, 46px tiles, centered favicons, selected fill, blurred backdrop, max 12, empty dragover promo.
- [ ] 7. Workspace switcher in the foot: 30px icons, grayscale-to-color active, horizontal scroll.
- [ ] 8. Foot buttons: expand, workspaces, create-new; column layout when collapsed.
- [ ] 9. Collapse/expand state machine on `zen-sidebar-expanded`.
- [ ] 10. Compact mode: off-canvas fixed sidebar, hover triggers, 0.25s spring reveal, 0.15s hide, 150/1000/800ms timings, edge zones.
- [ ] 11. Resizable splitter visible on hover, 8px, primary on hover, double-click reset to 230px.
- [ ] 12. Transparent header and footer; content separation 8px.
- [ ] 13. Drag-to-reorder indicator: 2px with round caps.
- [ ] 14. Drag-to-pin/essential/unpin/folder drop zones and dragover tint.
- [ ] 15. Tab context menu: reset pinned, edit/replace pinned URL, add/remove essential with count badge, edit title/icon.
- [ ] 16. Pinned reset affordance: icon-stack reposition and original-icon reset button with the rotated divider.
- [ ] 17. Audio/muted/blocked states and the glance note indicator.
- [ ] 18. Container 3px colored line; default-container line hidden.
- [ ] 19. Pending/discarded opacity 0.5.
- [ ] 20. Glance tabs: nested mini-tab, 24px, icon-only.
- [ ] 21. Close-button visibility on hover, 4px padding, 8px radius.
- [ ] 22. New-tab button placement, scale feedback, hidden on overflow.
- [ ] 23. Workspace pinned-tabs collapse chevron and indicator actions reveal.
- [ ] 24. Inline tab rename.
- [ ] 25. Sublabel collapse/expand at 10px, opacity 0.5.

## Scope -- Excluded (OUT OF BOUNDS)

- Boosts, Easel, Air Traffic Control, profiles, and sync (separate sprints).
- The Chrome Web Store install UI mounting (separate).
- The OpenCode agent backend (the rail stays a dock in this sprint).
- Any change to the window/tab content rendering in `arc-core.ts` beyond what the sidebar needs.

## Known Issues to Preserve

- The Arc state model (`spaces`, `tabs` with `kind: pinned|today`, `folders`, `archive`) is the contract. Map Zen vocabulary onto it: essentials map to `pinned`, workspaces map to `spaces`, normal tabs map to `today`.
- The BeUI blocks under `src/renderer/components/motion` and `src/renderer/components/agents` are copied source; do not rewrite them.
- The `design/banks/beui.md` decision: BeUI is the component source.
- Local CI is blocked; do not attempt to fix GitHub Actions in this sprint.

## Design Pass

### Preview adaptation

Zenmium is an Electron app, so there is no web preview. The proof surface is the launched app plus a CDP screenshot of the chrome renderer, compared side by side against Zen.

- **Design source**: `docs/zenmium/ZEN_SIDEBAR_SPEC.md` (from Zen `vertical-tabs.css`, `zen-workspaces.css`, `zen-theme.css`, `sidebar.inc.css`, `ZenCompactMode.mjs`, `ZenPinnedTabManager.mjs`).
- **State source**: `src/main/arc-core.ts` via `ARC_STATE_EVENT`.
- **Library source and installation state**: BeUI blocks installed under `src/renderer/components`; no new installs.
- **1:1 fidelity target**: every value in the spec's token table, every state in section 4, and every item in the section 8 checklist.
- **Desktop viewport**: the app window at 1440x900.
- **Verification receipt**: `tsc --noEmit`, `electron-vite build`, launch, CDP screenshot saved and inspected.

### Layout / Interaction

One sidebar column. Top: nav buttons + docked URL pill. Then essentials grid, then vertical tabs, then the agent dock, then the foot with new-tab, workspaces, and `⌘T`. Compact mode slides the sidebar off-canvas and reveals it on hover with Zen's timing. Collapsed rail centers icon tiles at 60px. All popups (context menu, workspace switcher, rename) animate in and out.

### Aesthetic Rules

- Zen is the design source; do not apply the Fintheon register.
- Do not invent geometry or colors: quote the spec's values.
- Toolbar and icon actions stay borderless and transparent; only primary fills and the selected/hover states carry a background.
- Every new popup, menu, and rail needs an enter and exit transition.

## Development Flow

1. **Foundation**: port the token set from the spec into `src/renderer/styles/zen-sidebar.css`; add `zen-sidebar-expanded`, `zen-compact-mode`, `zen-has-hover` attributes and the compact off-canvas transition.
2. **Top toolbar**: complete the top buttons row and the docked URL bar at the spec heights.
3. **Tabs**: finish all tab states (active press scale, hover, close visibility, pending, container line, audio/muted/blocked, pinned-changed reset, sublabel).
4. **Essentials**: the auto-fit grid, blurred-favicon backdrop, empty dragover promo, max 12.
5. **Workspaces**: the 44px current-workspace indicator, the switcher popup, the pinned-tabs chevron, actions reveal.
6. **Interactions**: splitter, drag reorder indicator, drag-to-pin/essential/folder drop zones and tint, inline rename.
7. **Context menu**: the tab context menu items and disabled/count states.
8. **Compact mode**: off-canvas geometry, hover and flash triggers, edge zones, exact timings.
9. **Validation**: `tsc`, build, launch, screenshot, compare to Zen.
10. **Ledger**: record results in `docs/zenmium/S002-receipt.md`.

## Acceptance Criteria

- [ ] The named solution resolves the original problem on the intended surface.
- [ ] Every checklist item 1-25 is implemented and visible in the running app.
- [ ] Every control performs its action through real interaction, with loading/disabled/error states where applicable.
- [ ] Design source `ZEN_SIDEBAR_SPEC.md` was read before planning; rendered proof shows no divergence from its token table for the implemented items.
- [ ] The execution lane and capacity gate passed before any install or build.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npx electron-vite build` passes.
- [ ] The app launches; the chrome renderer and a live content tab both appear.
- [ ] A CDP screenshot is captured and compared to Zen; differences are recorded.
- [ ] The Arc state model and BeUI blocks are preserved.
- [ ] A receipt is written to `docs/zenmium/S002-receipt.md` with per-item proof.

## Validation Commands

```bash
cd desktop
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/electron-vite build

# Launch and capture a screenshot of the chrome renderer
PORT=9551
./node_modules/.bin/electron . --remote-debugging-port=$PORT &
sleep 10
# then: curl http://127.0.0.1:$PORT/json and Page.captureScreenshot via the renderer target
```

## Commit Format

```
S002 - Zen sidebar 1:1 parity

Outcome: <what now matches Zen>
Principal areas: desktop/src/renderer/components/Sidebar.tsx, desktop/src/renderer/styles/zen-sidebar.css, desktop/src/renderer/hooks, desktop/src/main/arc-core.ts (read-only)
Proof: tsc, electron-vite build, launch, CDP screenshot
Protected zones: Arc state contract, BeUI blocks, theme tokens
Remaining blocker: <none or exact item>
```
