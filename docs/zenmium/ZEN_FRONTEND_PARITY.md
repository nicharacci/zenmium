# Zenmium frontend parity: implementation receipt

Status: substantial implementation, **not accepted as 95% parity**. Target branch: `2026-09-12`; review: https://github.com/nicharacci/zenmium/pull/8. Chromium and the existing agent/extension backends remain in place; this is not a port of Firefox internals.

## Baseline and evidence rules

Primary source baseline: installed macOS Zen 1.22b, BuildID `20260904060728`, SourceStamp `c2a638b7f735c7e7d4ee22e0182c8f6a16da93e5`. Exact package members, measurements, and provenance are recorded in [the reference](ZEN_FRONTEND_REFERENCE.md) and [MPL attribution](THIRD_PARTY_ZEN.md). A subsequent clean-profile launch updated the installed package to 1.22.1b. That drift is recorded separately, not silently substituted for the baseline. Original reference captures are from the still-running 1.22b process.

The checklist below measures evidence-backed implementation coverage, not a pixel-similarity percentage. Each group has ten explicit criteria: 1 = implemented with the cited evidence, 0.5 = partial implementation or incomplete runtime verification, 0 = absent/unverified. Group contribution = weight × sum of factors / 10. A source match alone does not prove native composition or an operating-system gesture. Critical-flow acceptance is a separate gate and cannot be averaged away.

Evidence keys:

- `REF`: source paths/line numbers in `ZEN_FRONTEND_REFERENCE.md`.
- `UNIT`: `npm test`, layout/reveal predicates, navigation normalization, migration, and drag command sequencing.
- `CORE`: `npm run test:native:build && npm run test:native`, isolated Electron windows and local HTTP/media/download fixtures; no mocked WebContents.
- `UI`: `npm run test:ui`, isolated visible Electron profile on port 9551; actual renderer → IPC → Arc → Chromium → snapshot flows. Its DOM drag test deliberately does not claim OS gesture coverage.
- `CAP`: whole native-window captures under `proof/`, with live Example Domain content; not an empty renderer screenshot.
- `CODE`: implementation inspection, a narrower claim than an exercised runtime scenario.

## Weighted checklist

### Shell appearance (30%)

| ID | Criterion | Factor | Implementation and verification / remaining difference |
| --- | --- | ---: | --- |
| S01 | Window gutter and native content bounds | 1 | Shared `browserLayout`, 8px gutter; UNIT, UI, CAP. |
| S02 | Content radius, shadow and clipping | 0.5 | Source 10.4px CSS/card shadow; native Electron radius must be integer 10px. CAP confirms live clipping, not fractional equality. |
| S03 | Expanded sidebar and elevated content card | 1 | Native sidebar and page views, shared bounds, CSS backing; UI, CAP. |
| S04 | Collapsed floating rail | 1 | Explicit persisted 60px rail and hover-expanded card; UNIT, right-side UI scenario. |
| S05 | Compact gutter reveal without page reflow | 1 | Separate native sidebar view above page; UNIT, UI, CAP. |
| S06 | Retention across pointer, focus, drag and popup | 0.5 | Predicates and timers tested; pointer/focus/popup exercised. OS drag retention remains unconfirmed. |
| S07 | Mirrored right-side composition | 1 | Shared geometry and mirrored sidebar/Glance controls; UNIT, UI, CAP. |
| S08 | Traffic lights, titlebar and drag regions | 0.5 | Native hidden-inset titlebar and non-drag controls. All window/fullscreen/titlebar variations not compared. |
| S09 | Typography, icons, theme and selected states | 0.5 | Source geometry with Lucide/BeUI wrappers; exact Firefox glyphs, computed colors and font rasterization are not 1:1. |
| S10 | Fullscreen, DOM fullscreen and no-padding modes | 0 | Resize/fullscreen callbacks exist; complete Zen mode behavior and equivalent native captures not verified. |

### Navigation and tabs (25%)

| ID | Criterion | Factor | Implementation and verification / remaining difference |
| --- | --- | ---: | --- |
| N01 | Back, forward, reload, stop and availability | 1 | Real WebContents navigation, native failure states; CORE, UI. |
| N02 | Address submission and search normalization | 1 | Safe URL resolver, local history/tab results, actual navigation; UNIT, UI. |
| N03 | Temporary new-tab entry, repeat and dismissal | 1 | No empty-tab accumulation before submission; session ownership and 45s draft code; UI repeat/dismiss/focus tests. |
| N04 | Docked address breakout versus floating palette | 0.5 | Docked display and source-sized floating entry; clicking the docked field still opens the floating treatment. |
| N05 | Select, close, MRU fallback and reopen | 1 | Arc lifecycle, monotonic activity ordering, archive; CORE, UI. |
| N06 | Pin destination reset and real mute | 1 | Saved reset URL, native mute, correct pinned close/discard policy; CORE, UI. |
| N07 | Real loading, playback and favicon states | 1 | Native events replace demonstration toggles; real WAV playback/mute test, navigation UI. |
| N08 | Rename and custom-title persistence | 1 | F2 inline editor and context menu, navigation preserves title; CORE, UI. |
| N09 | Drag reordering, pinning and folder movement | 0.5 | Capacity/ordered IPC tests and DOM-handler integration pass. Native macOS drag gesture is not confirmed. |
| N10 | Overflow and edge-case tab presentation | 0.5 | Scrollable tab list, 12-essential capacity and folder separation; all source count/overflow/drag combinations not captured. |

### Workspaces and menus (20%)

| ID | Criterion | Factor | Implementation and verification / remaining difference |
| --- | --- | ---: | --- |
| W01 | Create, edit and delete workspace | 1 | Arc-backed names/colors/icons, empty-workspace handling; CORE, UI. |
| W02 | Workspace switching and keyboard commands | 1 | Active state and previous/next commands, tab ownership; CORE, UI/code. |
| W03 | Saved workspace data and backward defaults | 1 | JsonStore, old shape defaults, explicit false retained; UNIT, CORE. |
| W04 | Folder grouping, rename and deletion | 1 | Main-process ownership and movement invariants; CORE, UI. |
| W05 | Per-workspace pinned-section collapse | 1 | Persisted optional field, true/false/omitted restart cases; CORE. |
| W06 | Workspace/folder drag destinations | 0.5 | Real move commands plus DOM folder drop; cross-workspace OS dragging not confirmed. |
| W07 | Tab and browser menu actions | 1 | Actions invoke actual capabilities with capacity/disabled states; UI, CODE. |
| W08 | Submenus, anchoring and keyboard fidelity | 0.5 | Focus trap/roving menus/Escape and viewport clamping; full Firefox submenu timing and nesting differ. |
| W09 | Workspace reorder and compressed overflow | 0 | Strip scrolls; Zen's reorder/compressed-dot overflow is not implemented. |
| W10 | Gradient themes and container UI | 0 | Workspace color/icon editing exists, not Zen's full gradient/container customization. |

### Utility surfaces (15%)

| ID | Criterion | Factor | Implementation and verification / remaining difference |
| --- | --- | ---: | --- |
| U01 | Actual split pages, focus and close semantics | 1 | Two live Chromium views; stable pane ownership and native focus regression coverage in CORE. |
| U02 | Split orientation, resizing and tab groups | 0 | Two equal columns only; no matching handles/orientation/group presentation. |
| U03 | Glance activation and live page ownership | 1 | Trusted Alt-click preload, parent does not navigate, close/promote real views; UI, CORE. |
| U04 | Glance visual transitions and close confirmation | 0.5 | 80%-wide card and external circular controls; .97 parent transform and focused-close confirmation remain absent. |
| U05 | History and archive | 1 | Native navigation history records and restore/clear actions; CORE, UI. |
| U06 | Downloads and actual transfer controls | 1 | Native download bytes, pause/resume/cancel/completion/persistence; CORE, UI panel. |
| U07 | Extensions access and host integration | 0.5 | Existing host listing/toggle/unpacked-load actions wired. Electron API compatibility is not Firefox/Chrome extension parity; no new extension installed for proof. |
| U08 | Settings and discreet agent entry | 0.5 | Real persisted shell preferences; agent closed at rest, existing backend retained. Neither full browser settings nor provider round-trip parity is claimed. |
| U09 | Background media-card stack | 0 | Actual tab audio/mute works; Zen's media stack/playback-seeking UI is absent. |
| U10 | Download flight and toast lifecycle | 0 | Transfer state works, source animation/toast surfaces are not implemented. |

### Motion and accessibility (10%)

| ID | Criterion | Factor | Implementation and verification / remaining difference |
| --- | --- | ---: | --- |
| M01 | Measured source motion values | 1 | Full compact sampled spring, reveal/hide durations, pressed state tokens; REF, CODE. |
| M02 | Runtime motion and interrupted transitions | 0.5 | Native viewport retained until CSS exit; no frame-by-frame equivalent reference comparison. |
| M03 | Escape dismissal and focus restoration | 1 | Native overlay session guard and focused live-page return; UI. |
| M04 | Keyboard traversal and popup focus containment | 1 | Shared focus primitives, dialogs and menus; UI. |
| M05 | Reduced-motion adaptation | 1 | Scoped final-state/no-animation override, source deviations documented; CODE. |
| M06 | Disabled states, labels and tooltips | 1 | Real capability/capacity gates, AX-exposed controls and labels; UI, native AX review. |
| M07 | IME, VoiceOver and contrast audit | 0.5 | Composition guards and accessible controls exist; full assistive-technology/contrast audit not executed. |
| M08 | Outside-window tracking and flash timing | 0 | Basic 150ms leave retained; Zen's outside-window 200/100 offsets and flash lifecycle not reproduced. |
| M09 | Persisted versus transient state separation | 1 | Main-owned preferences/migration separate from hover/focus/drag/popup, restart tests; UNIT, CORE. |
| M10 | Resize, overflow and repeated interruption stress | 0.5 | Pure edge geometry and native right-side checks; full resize/overflow stress matrix pending. |

## Score and acceptance gate

| Group | Weight | Earned |
| --- | ---: | ---: |
| Shell | 30 | 21.00 |
| Navigation/tabs | 25 | 21.25 |
| Workspaces/menus | 20 | 14.00 |
| Utilities | 15 | 8.25 |
| Motion/accessibility | 10 | 7.50 |
| Total | 100 | **72.00** |

Critical browsing flows verified: address/new-tab submission, live-page focus, navigation/history, pin/reset, real audio/mute, close/reopen, inline rename, workspace/folder ownership, popup Escape/focus, compact reveal/no-reflow, Glance and split lifecycle. Native OS drag/drop and physical split-pane clicking are still unconfirmed, so the critical-flow gate is **not passed**. CDP input reached the second page without focusing its native view; explicit native focus and stable pane ordering passed separately. The aggregate is also below 95. This receipt must not be presented as a completed 1:1 clone or a measured 95% visual match.

## Verification and reproduction

Final run: 70/70 pure tests; desktop TypeScript and production build passed; native core 27 passed, 0 failed, 2 input probes unavailable out of 29 attempted; visible scripted UI 14 passed with its native split-click probe explicitly unavailable. Trusted Alt-click passed in the visible suite. Disabling background throttling for trusted chrome keeps detached overlays current; a macOS Command-L check after debugger disconnection showed the refreshed address panel over live page content.

Run from `desktop/`: `npm test`, `npm run typecheck`, `npm run build`, then `npm run test:native:build && npm run test:native`. The native suite uses generated profiles and local fixtures. Its hidden-window trusted Alt-click probe may report unavailable; the visible UI suite separately exercises trusted Alt-click successfully.

For composed-window checks, launch the built Electron app with a fresh, explicitly generated user-data directory and `--remote-debugging-port=9551 --force-renderer-accessibility`. Never point `scripts/verify-browser.mjs` or `scripts/proof-state.mjs` at a personal profile. `npm run test:ui` writes `out/proof/native-interactions.json` by default; set `ZENMIUM_PROOF_DIR` to an artifact directory to retain it. `proof-state.mjs` prepares presentation states only in that isolated app; it is not a production demonstration control.

Full repository `pnpm validate` remains failing at lint, so its chained typecheck/discovery did not run. An earlier reference-work receipt recorded 2,172 errors and 5 warnings; after final scoped import/key/attribute organization, the final direct Biome check reports 2,350 errors and 6 warnings across the repository, including new desktop work. This is not all claimed to be pre-existing. Desktop typecheck/build are checked separately. Do not describe the whole repository as green. Verification used the existing installed dependencies and Node 26.7.0; the repository requests Node 24.x. No new dependency installation or lockfile update was needed.

## Remaining implementation priorities

1. Confirm/fix native macOS drag/drop, including reveal retention and cross-workspace movement, before critical-flow acceptance.
2. Complete split resizing/orientation/group presentation and Glance parent/confirmation behavior.
3. Reproduce media stack, toast/download flight, workspace reorder/overflow and theme customization.
4. Close docked-address, submenu, fullscreen/no-padding, exact glyph/color and assistive-technology gaps.
5. Capture every checklist state against one frozen, matching Zen build and rerun the weighted audit. The 1.22.1b drift cannot be treated as visually equivalent without comparison.

The React review and full-story verification skills informed wrapper separation, focus cleanup, native-boundary tests and the explicit distinction between source, DOM and operating-system evidence. BeUI internals and its protected motion/agent component directories were retained.
