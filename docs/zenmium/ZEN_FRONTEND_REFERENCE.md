# Zen frontend reference: installed 1.22b

Reference inspection date: 2026-09-12. This document records source evidence for Zenmium's UI/UX parity work. It does not report a parity percentage, measured screenshots, exercised interactions, or implementation completion. The main task owns live reference windows and visual verification. This sidecar used only repository guidance and installed application resources; it did not operate desktop UI or read a browsing profile, history, cookies, or credentials.

Read together with `ZEN_SIDEBAR_SPEC.md`. That earlier document describes the 1.22b lineage; the corrections below come from the exact installed build and retain distinctions between defaults, conditional rules, and live state.

## Exact reference and evidence rules

`/Applications/Zen.app/Contents/Resources/application.ini` identifies version `1.22b`, BuildID `20260904060728`, SourceRepository `https://github.com/zen-browser/desktop`, SourceStamp `c2a638b7f735c7e7d4ee22e0182c8f6a16da93e5`, and Gecko `155.0.1`. The file includes Mozilla's standard note that editing this file does not reconfigure the running application. Its contents identify this installed package; they do not establish live profile preferences.

Authoritative archive: `/Applications/Zen.app/Contents/Resources/browser/omni.ja`. Sources are the full installed, preprocessed archive members, including expanded CSS includes. Line numbers below refer to those members, not to GitHub's unprocessed source files. Retrieve a complete member with:

```sh
unzip -p /Applications/Zen.app/Contents/Resources/browser/omni.ja chrome/browser/content/browser/zen-styles/zen-omnibox.css
```

This optimized archive produces an extra-bytes/central-directory warning and `unzip -p` can exit 2 while returning the complete source. Check the member, length, and hash rather than treating that exit code alone as a missing source. Public GitHub sources were not needed. The repository revision, if needed for follow-up, is [the exact source revision](https://github.com/zen-browser/desktop/tree/c2a638b7f735c7e7d4ee22e0182c8f6a16da93e5), never a moving branch or release alias.

Source abbreviations: `S/` = `chrome/browser/content/browser/zen-styles/`; `C/` = `chrome/browser/content/browser/zen-components/`; `B/` = `chrome/browser/content/browser/`; `P/` = `defaults/preferences/`. These are archive paths. `P/firefox.js` has earlier Firefox defaults and later Zen overrides; the later declarations matter. A preference getter's fallback is not necessarily the shipped default.

`THIRD_PARTY_ZEN.md` records full-member byte/line counts and SHA-256 hashes, plus the package hash and licensing attribution. These identify complete source versions even when the installed application is later upgraded.

The operator configuration in `ZEN_SIDEBAR_SPEC.md` is prior task input, not independently inspected here: compact startup enabled, flash popup enabled, workspace indicator shown, session continuation, pinned-only sync. For example, `P/firefox.js:1749` ships flash popup disabled, whereas `C/ZenCompactMode.mjs:16–20` supplies a getter fallback of true. Neither overrides the operator configuration reported by main.

## Immediate corrections for implementation

| Area | Exact installed evidence | Action for the port |
| --- | --- | --- |
| Content-card radius | Native radius is set to 10px on macOS or 12px with `-moz-mac-tahoe-theme`; inner radius is `max(5px, (outerRadius - separation / 2) * 1.3)` unless `--zen-webview-border-radius` overrides it. `B/zenThemeModifier.js:100–138`; `S/zen-theme.css:279–286`. | With default separation 8px, derived radii are 7.8px / 10.4px. These are calculated CSS values, not screenshot measurements. Do not reuse the tab's 14px radius for the content card. |
| Workspace button | `S/zen-workspaces.css:31–35` declares 28px height and max-width, with collapsed min-width 36px at 97–99. | Replace the earlier generic 30px specification; retain the collapsed branch. |
| Floating address popup | Open floating state sets `--urlbar-container-height:62px`, margin-inline 12px, and macOS font-size 1.5em. Nonfloating single-toolbar breakout uses 52px. `S/zen-omnibox.css:19–47,479–507`. | Keep resting, nonfloating breakout, and floating-open states distinct. 36px applies to the docked placeholder container while the bar floats (`S/zen-tabs/vertical-tabs.css:98–107`), not to the open popup. |
| Compact outside-window offsets | Shipped defaults are horizontal 200px / vertical 100px. They are maximum travel outside the window before collapse, not reveal hot zones. `P/firefox.js:1744–1745`; `C/ZenCompactMode.mjs:37–50,902–1013`. | Reveal from actual toolbar/sidebar hover geometry; use these offsets for exit tracking only. Getter fallbacks of 250/150 are not the packaged defaults. |
| Essentials grid | Default minimum track is `max(23.7%, tabMinHeight + 4px)` with count-dependent `data-hack-type` variants. `S/zen-tabs/vertical-tabs.css:1118–1158`. | Do not implement an unrestricted `repeat(auto-fit,minmax(46px,1fr))`. Preserve count/width-dependent wrapping. |
| Essential versus ordinary pinned tab | Icon-only centered tiles and hidden labels/close buttons target `[zen-essential="true"]`; regular pinned tabs retain row labels and reset affordances. `S/zen-tabs/vertical-tabs.css:623–693,1161–1246`. | Model these as distinct states. |
| Tab shadow | Workspace selection uses `0 0.8px 1.5px 0` with black alpha .15 light / .05 dark. `S/zen-workspaces.css:411–416`. | The earlier checklist's “4px-bottom shadow” does not match this rule. |

## Window, card, and split geometry

| Surface/state | Values and behavior | Provenance |
| --- | --- | --- |
| Base separation | Shipped preference 8px, capped at 12px; applied minimum is 0.1px. The borderless fullscreen branch sets the conceptual separation to zero and applies the 0.1px sentinel with `zen-no-padding`. | `P/firefox.js:1712–1713`; `B/zenThemeModifier.js:144–190` |
| Normal content wrapper | `margin: separation`, `margin-top:0`; sidebar-facing margin is zero, left or right according to sidebar side. Tabbox gap is separation. | `S/zen-browser-ui.css:173–193` |
| Compact content wrapper | In the hide-sidebar/single-toolbar branch, both left and right margins are separation. Reveal overlays the content. | `S/zen-compact-mode.css:58–95,125–147` |
| Content card | `overflow:clip`, native inner radius, `--zen-big-shadow: rgba(0,0,0,.24) 0px 3px 8px`. Radius/shadow rule excludes no-padding and Glance overlay states, and outer selector excludes DOM fullscreen/hidden chrome. | `S/zen-browser-container.css:6–23`; `S/zen-theme.css:262–263` |
| Content backing | Ordinary content is white / `rgb(32,32,32)`; transparent content is white at .6 / white at .1. The page may paint its own surface. | `S/zen-browser-container.css:15–22` |
| Squircle | Theme uses `--zen-squircle-value:1.3` on macOS; a preference-gated `corner-shape:superellipse(...)` rule supplies actual corner shaping. | `S/zen-theme.css:220–224,459–464` |
| Split gutter | `--zen-split-row-gap:separation`; `--zen-split-column-gap:separation + 1px`, therefore 8px / 9px at defaults. Absolute pane margins and negative wrapper compensation produce the layout. | `S/zen-split-view.css:196–205,238–287` |
| Split focus and drag | Selected pane has a 2px active outline outside DOM fullscreen. Pane inset transition is 90ms ease-out except during resizing/no-transition; content opacity is 200ms ease-out. Dropzone inset is 80ms ease-out with secondary color 30% / transparent 70%. | `S/zen-split-view.css:207–215,256–275` |
| Split handle | Vertical/horizontal hit areas follow the respective gap. Hover marker is 2×50px or 50×2px with radius 2px and 100ms opacity transition. | `S/zen-browser-ui.css:247–304`; `S/zen-split-view.css:312–322` |
| Split pane controls | Header opacity transitions in 100ms and appears after 100ms hover delay; 6px radius with top corners zero, 16px controls, usual icons 14px, unsplit icon 10px. | `S/zen-split-view.css:324–389` |
| Split group in tabs | Outer row uses regular tab radius/height; expanded child tabs are 28px high with 8px tab radius. Child close affordance appears only in a hovered expanded group when its container is at least 70px wide, subject to pinned/pending restrictions. | `S/zen-split-view.css:42–159` |

## Address popup and new tab lifecycle

Resting single-toolbar URL height is set by JS to 38px; non-single-toolbar height is 34px on macOS. The 48px resting container token is a different quantity. Resting background uses `--zen-toolbar-element-bg`, no shadow, no border, 1px background margin; unexpanded input text is mixed to 70% opacity. `B/ZenUIManager.mjs:1277–1297`; `S/zen-omnibox.css:19–47,60–86,127–173`.

With `floating-on-type`, expansion floats when focus was not acquired by mousedown. Direct mouse focus takes the docked breakout branch; `float` mode always floats, and DOM fullscreen forces that mode. On collapse, the controller returns focus to the selected browser, clears the floating/breakout flags, and removes a temporary primary-adjustment suppression after 100ms. `B/urlbar/UrlbarInput.mjs:3055–3060,3088–3157`. This distinction is essential when comparing ⌘L with clicking the address bar. Search-mode changes use scale `[1,.98,1]` over 250ms and a 1s glow; this handler explicitly skips animation under reduced motion. `B/ZenUIManager.mjs:437–458`; `S/zen-animations.css:27–37`.

Open floating address UI is fixed, centered horizontally, z-index 1000. JS assigns width `min(window.innerWidth / 1.5,750)px` and top `innerHeight / 2 - max(333, measuredUrlbarHeight) / 2`; CSS also applies `min-width:min(90%,62rem)` and width fallback `min(90%,62rem)`. Respect both constraints; 750px is not an unconditional final rendered width, and do not convert rem/em without measuring the root font. `B/ZenUIManager.mjs:260–299`; `S/zen-omnibox.css:479–507`.

Breakout background radius is 12px; nonfloating non-single-toolbar background overrides this to `10px * squircle`. Shadow is `0 30px 140px -15px` with black alpha .8 light / .6 dark; outline is 0.5px black .2 / white .2 with offset 0px light / -2px dark. Base background is light `#fbfbfb`, or dark `color-mix(in srgb,hsl(0,0%,6.7%),var(--zen-colors-primary) 30%)`. Acrylic is preference-gated and shipped off; do not assume a blur is always present. `S/zen-omnibox.css:275–299,706–718`; `S/zen-theme.css:317–375`; `P/firefox.js:1711`.

Result typography is 14px / 500; secondary URL color `#4f4f4f` light / `#aaa` dark. Favicon padding 6px, trailing margin 12px, radius 3px. Results declare inline padding 8px and block padding 10px; selected rows mix the accent with black .5 / white .1 and force white text, with white-backed icons/badges for specified result types. Results body max-height is 252px and scrollbars are hidden. No-results state hides the results body. Preserve the case of source token names when resolving inherited rules. `S/zen-omnibox.css:523–588,650–725`.

The shipped configuration enables replacement of new tab by the URL bar, uses `floating-on-type`, and retains dismissed input for 45,000ms. `P/firefox.js:1726–1737`. `B/ZenUIManager.mjs:523–740` defines the lifecycle:

1. A plain new-tab request with no supplied URL or clipboard search, targeting a tab, enters `zen-newtab` when replacement is enabled. It saves the previous tab and URL label, removes that tab's visual selection, marks new-tab buttons `in-urlbar`, and focuses location input.
2. Repeating ⌘T while this state is open invokes its close handler. The same temporary state must not create accumulating empty tabs.
3. Close clears `zen-newtab`/`in-urlbar`, restores previous tab selection only if it is still the selected valid tab, and reverts URL text. Tab switching clears retained input; otherwise it expires after the preference duration.
4. A session/owner token prevents delayed close callbacks from closing a newer address popup. Keep this guard across rapid open, close, switch, and reopen sequences.

The internal `B/blanktab.html` is a 15-line document with color-scheme metadata and restrictive CSP, with no body content. It does not substantiate a dashboard, search tile grid, or a particular visible empty-state watermark. A visible empty state must be captured by main before being represented as measured reference evidence. `S/zen-tabs/vertical-tabs.css:328–329` hides `[zen-empty-tab]` rows. The vertical new-tab button uses selected fill/shadow while `in-urlbar`, scales .985 on active/open, and is ordered above tabs when `zen.view.show-newtab-button-top` is enabled; the packaged default is true. `S/zen-tabs/vertical-tabs.css:1060–1102`; `P/firefox.js:1707,1768`.

## Menus, workspaces, and pinned behavior

| Surface | Source reference |
| --- | --- |
| Menu container | macOS panel radius 10px / Tahoe 12px; generic menuitem padding 6px. `S/zen-popup.css:34–48`. Native appearance uses `Menu`, transparent panel background/border, and suppresses CSS shadow because the OS supplies it. `S/zen-panel-ui.css:33–58`. Do not claim the visible menu is shadowless or copy the address-popup shadow onto it. |
| App-menu rows | Radius 5px; padding 8px block / 14px inline; margins 2px block / 4px inline; icon-to-label gap 14px; separator width 1px, margins 2px vertical / 1px horizontal. Shortcut opacity .7. These tokens are for arrowpanel items, not a guaranteed native context-menu row height. `S/zen-popup.css:10–31,69–79,157–178`. |
| Native overflow | For app menu, widget panel, and overflow panel, native-context-menu mode caps max-height to available screen height minus 26px. The 26px is an upstream source comment's conservative native-chrome allowance, not a measurement made by this task. `B/ZenUIManager.mjs:337–367`. |
| Create-new menu | Menu source provides workspace creation, folder creation, separator, empty split, and new-tab actions. Its plus icon rotates 0→45° on open, reverses on close, 200ms each. `B/browser.xhtml:2795–2801`; `B/ZenUIManager.mjs:223–249`. |
| Workspace overflow | Inactive buttons can collapse to 4px dots in 10px min-width slots; active button remains visible until hovering another button. Icon opacity/transform transition is 150ms; press scale disabled during overflow. Reorder dims other items to .2. `S/zen-workspaces.css:102–211`. |
| Workspace indicator | Height 44px expanded / 38px collapsed. Icon 16px; actions 26px and fade in over 100ms on hover or open. Collapsed pinned-tabs chevron changes from 90° to 0°. `S/zen-theme.css:232–236`; `S/zen-workspaces.css:252–398,682–729`. |
| Pinned close | Packaged default is `reset-unload-switch`, not the module's fallback `switch`. Other branches are close, unload-switch, reset-switch, switch, and reset. Middle-click supplies `closeIfPending`; the all-pending close path excludes essentials. Glance closes first when unloading a pin with a Glance. `P/firefox.js:1679–1682`; `C/ZenPinnedTabManager.mjs:174–182,318–457`. |
| Reset pin | Restores the stored original entry/icon and removes scroll state. Accel-click of the reset icon duplicates current state before resetting the original. Replace pinned URL stores current state and shows a toast. `C/ZenPinnedTabManager.mjs:117–132,226–247,459–490`. |
| Pin menu state | Reset/edit-page visible only for singly selected pinned tabs; add-essential hidden for an essential or grouped tab, shows count/max badge, disabled when capacity disallows; close and unpin hidden for essentials. Rename is hidden for essentials, disabled rename preference, or collapsed sidebar. Max essentials shipped as 12. `C/ZenPinnedTabManager.mjs:690–748`; `P/firefox.js:1702`. |

## Keyboard defaults: compact mode versus temporary reveal

These are installed source defaults, not an inspection of saved user shortcuts or a claim of runtime verification. `accel` is Command on macOS. Keep shortcut labels and command routing consistent with the same action; expanded/collapsed sidebar width is not the compact-mode reveal state.

| Action | macOS default | Exact installed provenance and port requirement |
| --- | --- | --- |
| Toggle compact mode | ⌘S | `C/ZenKeyboardShortcuts.mjs:751–762` binds `zen-compact-mode-toggle` to `cmd_toggleCompactModeIgnoreHover` with only `accel`. `C/ZenCompactMode.mjs:662–665` toggles the compact preference and can ignore the next hover when enabling it. ⌘⇧L is not this source default. |
| Show/hide sidebar within compact mode | ⌘⌥S | `C/ZenKeyboardShortcuts.mjs:763–773` binds `zen-compact-mode-show-sidebar` to `cmd_zenCompactModeShowSidebar` with `accel` + `alt`. The compact controller's `toggleSidebar()` toggles the transient `zen-user-show` attribute (`C/ZenCompactMode.mjs:674–675`); changing compact preference clears that attribute (`:190–199`). Do not turn this shortcut into a persisted expanded/collapsed-width toggle or an unconditional timed flash. |

Additional full-source identity: `C/ZenKeyboardShortcuts.mjs` is 1,656 newline-delimited lines / 45,330 bytes; SHA-256 `ffd644eb8a9578896ae4f003418a8d4559a2e64fbe8ff33b278c82e627dd5637`, calculated over the entire installed member. The source's user-customization and migration machinery means existing profiles may differ from these defaults; no profile was read here.

## Compact motion and utility surfaces

Compact reveal predicates are `[zen-has-hover]`, `[zen-user-show]`, `[zen-has-empty-tab]`, `[flash-popup]`, `[has-popup-menu]`, `[movingtab]`, `[zen-compact-mode-active]`, or root `zen-renaming-tab`. A floating URL popup is excluded from the sidebar's ordinary open-panel observer; the toolbar observer also tracks URL focus. `S/zen-compact-mode.css:209–215`; `C/ZenCompactMode.mjs:217–249`.

Hide transitions left/right/visibility for 150ms ease. Reveal transitions left/right for 250ms with the full sampled `linear()` spring in `S/zen-compact-mode.css:217–319`: it passes 1 at 59%, peaks at 1.010904 at 73%, and ends at 1.003423. Do not replace that full curve with a guessed cubic-bezier and label it exact. Float is separation (8px by default), or 10px in no-padding; open offset is `-float/2`, hidden offset is `-actualSidebarWidth + separation/2 + 1px`. Single-toolbar top offset is `float/2 + compactTopOffset`, height `100% - float`. `S/zen-compact-mode.css:108–159,177–201,320–335`.

Sidebar leave retention is 150ms. Flash duration is 800ms, but `flashSidebar` suppresses it in split view. 1000ms toolbar-hide duration is used as the outside-window tracking fallback, not as an unconditional delay for every toolbar mouseleave. Ordinary non-sidebar leave removes hover in a requested frame. Re-entry cancels queued flash/leave work; tab drag and popups can retain visibility. `C/ZenCompactMode.mjs:678–727,785–968`; `P/firefox.js:1748–1751`.

| Utility | Geometry, motion, and behavior | Provenance |
| --- | --- | --- |
| Toolbar and page-action press | Usual radius 8px, inner padding 6px, outer padding 1px, icon color mixed to 70%. Background transitions 100ms, transform 200ms; active+hover scales .95 unless the control is open. Workspace and other specialized selectors can override these values. | `S/zen-single-components.css:185–205` |
| Glance | Final browser wrapper 80% width / 100% height, centered; uses native inner radius and card shadow. Parent background scales .97 and fades to opacity .3, spring bounce .2. Animation preference is 350ms; action entrance moves ±20px/fades over 200ms after a 150ms delay at defaults. Expansion to full tab uses 250ms scale `[1,1.005,1]`. | `S/zen-glance.css:96–165`; `C/ZenGlanceManager.mjs:9,42–44,288–305,477–493,818–820,1687–1700`; `P/firefox.js:1659–1664` |
| Glance actions | Outside overlay's sidebar-facing edge, top 15px, padding/gap 12px, max-width 56px. Circular buttons with 8px padding and `0 0 12px 1px rgba(0,0,0,.07)` shadow; 50ms bg/scale, hover 1.02, press .98, disabled image opacity .5. Focused-close confirmation sets a red close button with expanding label for 3 seconds. | `S/zen-glance.css:7–94`; `C/ZenGlanceManager.mjs:930–948` |
| Glance activation | Shipped activation modifier is Alt; code supports Ctrl/Alt/Shift/Meta. Essential external-link opening and context-menu search have preference-gated paths. These source branches still require main's live verification. | `P/firefox.js:1659–1664`; `C/ZenGlanceManager.mjs:1555–1558,1716–1747,1926–1927` |
| Toast | Opposite sidebar side at `max(4px,separation)`, z-index 1000. macOS padding 8px, height 48px, radius 14px, gap 8px, font 14px/600; shadow black .1 light / .4 dark, `0 0 22px 2px`. Entrance spring .5s / bounce .2; exit .2s to opacity 0/scale .5. Default timeout 2s, paused by hover and restarted on exit. | `S/zen-popup.css:307–399`; `B/ZenUIManager.mjs:810–867` |
| Media stack | At most 3 visible cards. Stack peek 8px, gap 6px, scale reduction .04 and opacity reduction .3 per peek level. Container stays at collapsed height; cards expand upward over the sidebar. Hidden when sidebar collapsed. Hover details .3s; stack transform .35s; easing `cubic-bezier(.25,1,.5,1)`. | `C/ZenMediaController.mjs:13–18`; `S/zen-media-controls.css:7–12,78–122,134–199,271–293,393–397` |
| Media controls | 26px icon boxes/5px padding; seek track 4px, thumb 8px scales in on hover over .15s. Unsupported playback actions are disabled; seeking and close operate the controller. Close pauses media and destroys the card. No-PiP/media-sharing states alter controls. Removal sinks .5rem, fades/blurs over .3s. | `S/zen-media-controls.css:20–75,174–228`; `C/ZenMediaController.mjs:241–245,347–419` |
| Media visibility | Media card represents a background browser; selected-browser playback and PiP/fullscreen controller usage hide it. Sharing cards are separately eligible. Playback is rechecked after 1000ms before revealing a new card, so short notification sounds do not leave cards behind. | `C/ZenMediaController.mjs:88–96,510–526` |
| Download animation | Box 40×40px with native outer radius/card shadow, icon 50%, pointer-events none, z-index 1100. Shipped animation enabled/duration 1000ms. Arc uses that duration and `cubic-bezier(.37,0,.63,1)`; box can enter from -50px to 34px over .35s, settle at 24px over .2s, then depart. | `S/zen-download-box-animation.css:6–27`; `P/firefox.js:1652–1654`; `C/ZenDownloadAnimation.mjs:251–256,394–444,464–484` |

Reduced-motion support is selective in the installed files: tab scale transitions and workspace padding transitions are gated; not every compact, media, popup, or Glance animation is explicitly gated in the inspected rules. Record any accessibility adaptation made by the port as an adaptation, and verify its final static state separately. Do not claim a universal source reduced-motion rule.

## Reference state matrix for main

Every row below is source-backed, with runtime/screenshot verification pending. Use synthetic pages and tabs. Record window CSS dimensions, scale factor, macOS theme, sidebar side/width, toolbar mode, color scheme, compact preferences, and reduced-motion setting with each capture. Font size, dynamic color values, native shadow, and exact final popup rectangles remain computed/runtime questions.

| State pair / transition | Acceptance observation to capture |
| --- | --- |
| Light / dark; macOS / Tahoe branch | Correct derived card radius, backing, outline, selected shadow, text, and native menu appearance. |
| Expanded / collapsed; left / right | Sidebar width, content-facing margin, centered collapsed icons, workspace actions, hidden media, mirrored popup/Glance placement. |
| Compact hidden / hover / leave / re-entry | Geometry, 250ms spring reveal, 150ms hide, leave retention, canceled timers, content remaining available underneath. |
| Compact open popup / drag / rename | Sidebar retains required visibility; ordinary hover exit does not dismiss an active interaction. |
| ⌘S / ⌘S again; compact ⌘⌥S / repeat | Compact preference toggle and temporary user-show toggle remain distinct; correct menu hints, no mistaken ⌘⇧L binding, no persisted sidebar-width change from temporary reveal. |
| Resting URL / docked breakout / floating open | Distinct height tokens, correct final popup width/top, font, outline and shadow; no-results body hidden. |
| ⌘T / ⌘T again / dismiss / rapid reopen / switch tab | Temporary visual selection, input retention/expiry, restoration, and session-token protection; no accumulating empty tabs. |
| Result hover / selected / keyboard navigation / scroll | Different backgrounds and badges, visible selection, max 252px body, input stays usable. Keyboard behavior needs runtime verification beyond CSS. |
| Normal / pinned / essential / pending / audio | Distinct row/tile layout, reset versus close, correct mute/audio overlay, actual close/unload/reset behavior. |
| Essentials counts and resize; full capacity | Count-dependent grid variants and 12-item cap; accurate badge and disabled add action. |
| Workspaces normal / overflow / reorder / collapsed pins | 28px buttons, dot compression, grayscale/opacity state, chevron and action visibility. |
| Menu open / submenu / keyboard / near screen edge | Native container, row spacing, focus and dismissal, panel height limit; no clipped final items. |
| Split horizontal / vertical / focus / resize / unsplit | 8px/9px source gaps, active outline, handles, transitions suspended during resize, narrow group controls. |
| Glance open / focus / confirm close / full open | 80% overlay, .97 parent, external controls, confirmation reset, tab ownership/restoration. |
| Media inactive / playing / paused / stacked / close | Delayed eligibility, available controls, upward expansion without sidebar reflow, pause on close. |
| Toast first / repeated / hover / expiry; download | Correct placement, lifetime restart, active animation and cleanup. |
| Window fullscreen / DOM fullscreen / no-padding / return | Correct sentinel/no-padding exceptions, split separation, card radius restoration, hover state. |
| Reduced motion / reduced transparency | Stable final states, documented adaptations, preference-gated acrylic behavior. |

The matrix is a verification plan, not a passed checklist. Main must attach evidence and report remaining gaps before assigning any parity score.

## Documentation verification

Both authored documents passed `git diff --no-index --check /dev/null <file>`. Full-member hashes were calculated directly from the archive, and references were checked against numbered installed source. Repository `pnpm validate` was attempted; it stopped at `ultracite check` with 2,172 errors and 5 warnings in the current shared workspace, including desktop code outside this sidecar's ownership. No lint fixes were applied. The environment also reported Node 26.7.0 while the repository requests Node 24.x. Typecheck and discovery did not run because the validation chain stopped at lint. No application/TUI or desktop reference interaction was performed by this sidecar.

## Append-only reference drift notice: 1.22.1b

At `2026-09-12T22:11:01.466Z` (UTC), package-file inspection confirmed that the installed application had changed to `1.22.1b`, BuildID `20260911034930`, SourceStamp `d7441097171a1a9d47ee40a3e6fcd71bd01784a4`. Main reported the update on a new clean-profile launch; this sidecar did not operate UI or inspect profiles.

The source findings and original process/capture baseline above remain **1.22b / c2a638b7f735c7e7d4ee22e0182c8f6a16da93e5**. The append-only drift receipt in `THIRD_PARTY_ZEN.md` records the new package hashes and all 28 baseline comparisons: **15 changed, 13 byte-identical**. Changed files include seven stylesheets and six controllers, plus packaged defaults and browser markup. The keyboard addendum's separately recorded module hash still matches. These hash results do not establish semantic or visual equivalence; later captures must carry the updated build identity. No baseline hashes or measurements were replaced.
