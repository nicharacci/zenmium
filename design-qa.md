# Zenmium design QA

## Reference baseline

The current baseline is the supplied Zen screenshots plus the installed Zen
browser’s macOS chrome: an 8 px glass gutter, frameless expanded sidebar,
hover-revealed full sidebar, elevated live Chromium card, overflow bookmark
chips, and the right-side agent dock.

## Parity matrix

| Surface | Zenmium behavior | Verification |
| --- | --- | --- |
| Shell | Frosted, workspace-tinted glass under an elevated live page card; tint is adjustable in Settings. | Native window layout plus production build |
| Sidebar | Expanded mode is frameless; collapsed/compact modes reveal the full menu over the page from the gutter. | `Compact gutter reveal keeps live page geometry and input intact` |
| Essentials | Four large sidebar tiles, eight-pin maximum, overflow pins become top bookmark chips, and the strip disappears when there is no overflow. | Arc drag-capacity tests and live DOM checks |
| Tabs | Active tab uses a transparent pearl treatment with inset depth instead of a solid selected fill. | Computed-style check: transparent background and inner shadow |
| Workspace | Named workspaces, color-gradient rows, bottom current-workspace control, and double-click editing remain in the sidebar. | Workspace/folder integration checks |
| URL pill | Copy link fades in inside the URL pill on hover or focus. | Sidebar DOM and interaction check |
| Agent | BeUI chat is docked on the right, shrinks the native Chromium bounds, has no modal backdrop/header, and uses a single glowing liquid-glass composer. | Docked-agent DOM check and native layout path |
| Chat history | Borderless caret section sits above the workspace control, groups by workspace, supports an All workspaces filter, right-aligned decay labels, and restores persisted transcripts. | IPC persistence and sidebar DOM checks |
| Motion | Startup and agent activity use a bottom-left dithered wave; theme color transitions animate through registered CSS tokens. | CSS reduced-motion rules and live renderer build |

## Native verification

The production build passed the scripted native proof. It covers navigation,
real new tabs, focus restoration, pin/reset, rename, drag/drop, compact reveal,
Glance, workspace persistence, utilities, and right-side/collapsed geometry.
The native harness reports 36/36 attempted cases with zero failures; trusted
Alt-click and an unfocused split-pane click remain explicitly unavailable when
the host is hidden or CDP-controlled. The live UI verifier reports 14 passing
flows and records those CDP limitations rather than presenting them as native
gesture certification.

The BeUI command was run in `desktop/`:

```text
npx shadcn add @beui/chat-app
```

The registry reported the BeUI internals were already identical and skipped
them; the integration wraps those existing internals without editing them.

## Remaining differences

- Genuine signed 1Password browser/native-messaging connectivity and TOTP
  round-trip remain release blockers until the installed extension, signed
  Zenmium bundle, and provider are available. The broker fails closed and does
  not simulate credentials.
- Notarization credentials are not configured. The local macOS bundle is
  distribution-signed and fuse-verified, but no v0.0.1 release is claimed.
- Native split-pane pointer certification still requires a focused manual
  macOS gesture; the pane layout and tab state paths are covered by the proof.
