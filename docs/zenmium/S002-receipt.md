# S002 - Zen sidebar 1:1 parity receipt

## Outcome

Implemented the Zen-style sidebar surface in `desktop/` on branch `2026-09-12`.
The sidebar now has the Zen vertical-tab structure, persisted expanded/collapsed
state, left/right placement, compact hover reveal, essentials, workspaces,
folders, tab state treatments, context actions, drag interactions, and the
floating card shell requested for the app window.

## Proof gates

| Gate | Result |
| --- | --- |
| `./node_modules/.bin/tsc --noEmit` | Pass |
| `./node_modules/.bin/electron-vite build` | Pass |
| Electron launch | Pass with `--no-sandbox --disable-gpu` and CDP on `9551` |
| Renderer target | `file:///Users/tifos/Documents/zenmium/desktop/out/renderer/index.html` |
| Live content target | GitHub tab target present at `https://github.com/nicharacci/zenmium` |
| Native CDP geometry | Expanded content card measured `x=12,y=12,w=1072,h=876`; collapsed rail measured `x=8,y=8,w=60,h=884` |
| Screenshot review | Pass; compared against the installed Zen window treatment |

Screenshots captured from the native renderer:

- [Expanded content card](S002-native-sidebar.png)
- [Hover-revealed expanded sidebar](S002-native-sidebar-hover.png)
- [Collapsed floating rail](S002-native-sidebar-collapsed.png)
- [Collapsed rail revealed from the window gutter](S002-native-sidebar-collapsed-hover.png)

## Per-item proof

| # | Proof |
| ---: | --- |
| 1 | `Sidebar.tsx` renders a measured 230px sidebar, 60px rail, resizable splitter, and left/right placement. |
| 2 | Tab rows use the specified 2px spacing, 14px row radius, 8px inline padding, 36px height, and 16px favicon. |
| 3 | Active, hover, selected background, shadow, press scale, and rotation are implemented in `zen-sidebar.css`. |
| 4 | Top compact toggle, separator, navigation, extensions, and menu controls are present. |
| 5 | The URL pill is docked in the sidebar with the specified 48px container and 36px control geometry. |
| 6 | Essentials use a four-pixel grid, 46px tiles, 12-item cap, selected fill, and empty dragover promo. |
| 7 | Workspace buttons and active grayscale/color treatment are rendered in the footer. |
| 8 | Expand, workspace, and new-tab footer controls collapse into the rail layout. |
| 9 | `zen-sidebar-expanded` and persisted local state drive the expand/collapse state machine. |
| 10 | Compact mode uses fixed off-canvas geometry, edge zones, hover/user reveal, and Zen timing curves. Native CDP verified the reveal path. |
| 11 | The eight-pixel splitter is hover-visible and double-click resets width to 230px. |
| 12 | Header/footer remain transparent with eight-pixel content separation. |
| 13 | Drag reorder renders a two-pixel rounded indicator. |
| 14 | Essentials, pinned, normal, and folder drop targets support dragover tint and mutations through Arc IPC. |
| 15 | Tab context menu includes reset, URL/icon/title editing, essential count, mute/glance/folder, and close actions. |
| 16 | Pinned-changed tabs show the original-icon reset affordance and rotated divider. |
| 17 | Audio, muted, blocked, and glance markers have dedicated tab treatments. |
| 18 | Container tabs render a three-pixel color line while default containers remain unmarked. |
| 19 | Pending and discarded tabs render at 50% opacity. |
| 20 | Glance tabs render as nested 24px icon-only mini-tabs. |
| 21 | Close controls appear on tab hover with the Zen-sized hit target and feedback. |
| 22 | New-tab placement is persisted top/bottom, scales on press, and hides on overflow. |
| 23 | Workspace pinned-tab chevrons and hover-revealed indicator actions are present. |
| 24 | Tabs support inline rename on double-click and from the context menu. |
| 25 | Sublabels render at 10px with reduced opacity and collapse with the tab state. |

## Protected-zone notes

- Arc remains the state authority; sidebar mutations use existing IPC plus the
  additive `arc:updateTab` patch channel.
- Existing IPC channel names and BeUI agent/command blocks were preserved.
- No new dependencies were installed.
