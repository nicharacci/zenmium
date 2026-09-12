# Zen sidebar specification (reverse-engineered)

Reverse-engineered from `zen-browser/desktop` (MPL-2.0) at the `1.22b` lineage: `src/zen/tabs/zen-tabs/vertical-tabs.css`, `vertical-tabs-topbar.inc.css`, `src/zen/common/styles/zen-theme.css`, `zen-browser-ui.css`, `src/zen/compact-mode/sidebar.inc.css`, `src/zen/compact-mode/ZenCompactMode.mjs`, `src/zen/spaces/zen-workspaces.css`, `src/zen/tabs/ZenPinnedTabManager.mjs`, and `ZenUIManager.mjs`. This is the design source of truth for the Zenmium sidebar. Where Zen relies on Firefox design-system tokens (`--tab-min-height` = 36px, `--icon-size`, `--size-item-*`), the value is recorded explicitly.

Operator config (release profile): compact mode on at startup (`zen.view.compact.enable-at-startup=true`), toolbar flash popup on, workspace indicator shown, continue-where-left-off, sync-only-pinned-tabs. Compact mode is therefore in scope.

## 1. DOM order (top to bottom)

`#navigator-toolbox`
1. `#zen-sidebar-top-buttons` — compact toggle, separator, and in single-toolbar mode the nav buttons, unified-extensions, PanelUI.
2. `#nav-bar` — `#back`, `#forward`, `#stop-reload`, `#urlbar-container`, then overflow.
3. `#titlebar` > `#TabsToolbar`:
   - `#zen-essentials` (essentials grid)
   - `#zen-tabs-wrapper` > `#tabbrowser-tabs` (vertical tabs, new-tab button, periphery)
   - `#zen-sidebar-foot-buttons` — expand-sidebar, workspaces button, create-new.

State attributes: `zen-single-toolbar`, `zen-sidebar-expanded`, `zen-right-side`, `zen-compact-mode`, `zen-has-hover`, `zen-user-show`, `zen-has-empty-tab`, `zen-compact-mode-active`.

## 2. Single toolbar / URL bar

- `#urlbar-container` full width in the sidebar; nav buttons move into `#zen-sidebar-top-buttons`.
- `--urlbar-container-height`: 48px resting; 52px breakout; 36px floating breakout. `--urlbar-height`: 38px single-toolbar. `--urlbar-margin-inline`: 5px, `--urlbar-container-padding`: 4px.
- Top buttons: `margin: calc(var(--zen-toolbox-padding)/2) 0`; height 36px (macOS 38px). Topbar wrapper height 34px.

## 3. Design tokens (verbatim)

| Token | Value |
| --- | --- |
| `--zen-min-toolbox-padding` | 5px, **6px macOS** |
| `--border-radius-medium` (tab) | 14px |
| `--tab-border-radius` | 8px |
| `--tab-min-height` (upstream) | 36px |
| `--tab-margin-block` | 2px |
| `--tab-inline-padding` (expanded) | 8px |
| collapsed `--tab-min-width` | 48px |
| essentials `--tab-min-height` | 46px |
| `--zen-active-tab-scale` | 0.985 |
| `--zen-element-separation` | 8px |
| `--zen-workspace-indicator-height` | 44px (38 collapsed) |
| macOS sidebar width default | 230px |
| `--zen-urlbar-background` (dark) | `color-mix(in srgb, primary 4%, rgb(24,24,24) 96%)` |
| selected tab bg (dark) | `color-mix(in srgb, rgba(255,255,255,0.18) 95%, primary)`; shadow `0 0.8px 1.5px 0 rgba(0,0,0,0.05)` |
| hover bg | `rgba(255,255,255,0.1)` |
| toolbar element bg (dark) | `color-mix(in oklch, textcolor 15%, transparent)` |
| `--zen-colors-border` | `color-mix(secondary 20%, rgb(79,79,79))` |
| tab icon | 16px, radius 4px, fill-opacity 0.5 |
| workspace button | 30px, radius 6px; icon 12px (macOS 14px) |
| workspace indicator icon | 16px |
| drag indicator | 2px, `50% primary / 50% contrast`, radius 5px, z-index 1000 |
| backdrop blur on essentials (pref default) | `inset:-50%`, `blur(20px)` of the favicon |
| essentials max | 12 |

## 4. Tab states

- Resting: block margin 2px, radius 14px, inline padding 8px, height 36px, icon 16px radius 4px, label 12.5px truncate.
- Hover: `background: rgba(255,255,255,0.1)`; close button appears.
- Active/selected: selected background plus `0 0.8px 1.5px 0 rgba(0,0,0,0.05)` shadow; press scale `0.985` with `rotate: 0.01deg` (GPU anti-blur); icon press scale `0.97`.
- Audio: expanded audio button offset `margin-inline-start:-4px; margin-inline-end:2px; margin-top:-1px`; pinned/collapsed overlay icon.
- Muted / blocked: overlay icon variants.
- Container: 3px colored line inside the tab background (default container line hidden).
- Pending/discarded: opacity 0.5.
- Essential/pinned: full-width tile, centered favicon, no label/close, radius 14px, height 46px; selected bg `rgba(255,255,255,0.2)` dark; optional blurred-favicon backdrop.
- Pinned-changed: icon stack pinned to left 8px; reset button shows the original icon with a 2.5px rotated divider.
- Glance: nested mini-tab, 24px (floating essential 34x16), icon-only.
- Close button: hidden until row hover; 20px area, radius 8px, hover `color-mix(currentColor 10%, transparent)`.

## 5. Essentials

CSS grid, `gap:4px`, `grid-template-columns: repeat(auto-fit, minmax(46px,1fr))`, `padding-top:6px; padding-bottom:2px` in single-toolbar, containers full width plus toolbox padding. Empty state shows a dashed `zen-essentials-promo` drop target (`border:1px dashed primary`, radius 14px). Max 12; drag a tab in to add.

## 6. Workspaces

Switcher in the foot: `display:flex; gap:3px; overflow-x:auto`; each button 30px, radius 6px, `filter:grayscale(1); opacity:0.7`, active `grayscale(0); opacity:1` with fill `--zen-sidebar-themed-icon-fill`; hover background `--zen-toolbar-element-bg`. Current-workspace indicator is 44px (38 collapsed) with a hover/open pill (`radius 14px`, `background: hover`), 16px icon, 26px action icons revealed on hover/open, and a collapse chevron for pinned tabs.

## 7. Interactions

- Collapse/expand: `zen-sidebar-expanded` toggles; collapsed uses `--tab-min-width:48px`, `--zen-toolbox-padding:6px`, labels hidden, icons centered, foot buttons column, splitter hidden. Splitter (`#zen-sidebar-splitter`) is cursor-resizable, visible on hover, 8px, primary on hover, double-click resets to 230px (macOS).
- Compact mode: `zen-compact-mode`; sidebar is `position:fixed`, off-canvas, `--zen-compact-float: var(--zen-element-separation)` (8px). Reveal on hover via `zen-has-hover` / `zen-user-show` / `zen-has-empty-tab` / `flash-popup` / `has-popup-menu` / `movingtab`; `left/right 0.15s ease` hide, `0.25s` spring reveal with the overshoot `linear()` curve; sidebar keep-hover 150ms, toolbar hide 1000ms, flash popup 800ms; edge reveal zones 200px horizontal, 100px vertical.
- Keyboard: `cmd_zenToggleSidebar`, `cmd_zenCompactModeToggle`, `cmd_toggleCompactModeIgnoreHover`, `cmd_zenToggleTabsOnRight`; `⌘1..9` tab select; `⌘L` focus URL; `⌘T` command; tab rename on double-click.
- Drag: tab drag shows a 2px indicator; drop zones: essentials container (add essential, max 12), pinned section (pin), normal section (unpin), folders (group); workspace-edge drag switches workspaces after a 20px threshold; dragover background tint `var(--zen-primary-color)`.
- Context menu: reset pinned tab, edit/replace pinned URL, add/remove essential (count `num/max`, disabled when full), edit tab title, edit tab icon; close hidden for essentials; close-shortcut on a pinned tab resets-unload-switches by default.
- New tab: `#tabs-newtab-button` (vertical) top or bottom per pref; hidden on overflow.

## 8. Port checklist (all 25 in scope)

1. Full-width vertical tab list in a resizable left/right sidebar, measured width, expanded 230px vs collapsed 48px content (60px rail) and right-side option.
2. Tab rows: 2px block margin, 14px radius, 8px inline padding, 36px height, label + 16px radius-4 favicon.
3. Active tab: 0.985 press scale + 0.01deg rotate, selected bg and 4px-bottom shadow; hover bg.
4. Sidebar top buttons row: compact toggle + separator + nav buttons + extensions + PanelUI at 36px (macOS 38px).
5. URL bar docked in the sidebar: full width, 48px container, 36px pill, 4px input padding, rounded breakout.
6. Essentials grid above tabs: auto-fit, 4px gap, 46px tiles, centered favicons, selected fill, optional blurred backdrop, max 12, empty dragover promo.
7. Workspace switcher in the foot: 30px icons, grayscale-to-color, active fill, horizontal scroll.
8. Foot buttons: expand-sidebar, workspaces, create-new; column layout when collapsed.
9. Collapse/expand state machine with the `zen-sidebar-expanded` attribute and collapsed sizing.
10. Compact mode: off-canvas fixed sidebar, hover/user-show/flash triggers, 0.25s spring reveal + 0.15s hide, 150/1000/800ms timings, edge zones.
11. Resizable splitter visible on hover, 8px, primary on hover, double-click reset.
12. Transparent sidebar header/footer; content margin `--zen-element-separation`.
13. Drag-to-reorder indicator: 2px primary/contrast with round caps.
14. Drag-to-pin/essential/unpin/folder drop zones and dragover tint.
15. Tab context menu: reset pinned, edit/replace pinned URL, add/remove essential with count badge, edit title/icon; close hidden for essentials.
16. Pinned reset affordance: `zen-pinned-changed` icon-stack reposition, original-icon reset button with the 2.5px rotated divider.
17. Audio/muted/blocked states: expanded audio button offset, overlay icons, glance note indicator.
18. Container 3px colored line; default-container line hidden.
19. Pending/discarded opacity 0.5.
20. Glance tabs: nested mini-tab, 24px, icon-only.
21. Close-button visibility on hover, 4px padding, 8px radius, hover/active feedback; pinned/essential restrictions.
22. New-tab button placement (top/bottom pref), scale feedback, `[in-urlbar]` state, hidden on overflow.
23. Workspace pinned-tabs collapse chevron, indicator open/hover, actions reveal.
24. Inline tab rename.
25. Sublabel collapse/expand (10px, opacity 0.5) for pinned hints.
