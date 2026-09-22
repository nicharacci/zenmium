# S005 - Helium base (T1 foundation)

## Outcome

Zenmium rebases onto a vendored clone of Helium: the shared browser tree in
`browser/` and the per-OS build harnesses in `platform/macos` and
`platform/windows`. Zenmium identity ships as overlay patches under
`patches/zenmium/` plus direct script edits; upstream trees stay byte-identical
under their `helium/` namespaces so future rebases are mechanical.

## Upstream pins

| Tree | Upstream | Tag | Resolved commit |
| --- | --- | --- | --- |
| `browser/` | `imputnet/helium` | `0.17.2` (Chromium 153.0.8010.52, helium rev 2) | `8c19f4c6d624e31293bca13e655f2fe542ba6fdb` |
| `platform/macos/` | `imputnet/helium-macos` | `0.17.2.2` | `359e3c5711a7c727499948bc9413aedabe3295ae` |
| `platform/windows/` | `imputnet/helium-windows` | `0.17.2.2` | `a3a181707825c2c5117a96655cbc09a35beebe4a` |

Each tree carries its own `PROVENANCE.md`. The upstream `helium-chromium`
submodule in the platform repos is replaced by a `helium-chromium` symlink to
`../../browser`; CI materializes the directory if the link does not survive
checkout. Upstream `.gitmodules`, `.github/`, `docs/`, and license files were
kept as provenance; upstream `AGENTS.md`/`CLAUDE.md` (an agent contribution
ban aimed at imputnet PRs) was intentionally not vendored and that divergence
is recorded in `browser/PROVENANCE.md`.

## Zenmium identity map

Identity is `com.zenmium.desktop` / `Zenmium` end to end.

- `browser/patches/zenmium/identity-branding.patch` - BRANDING file
  (`PRODUCT_*=Zenmium`, `MAC_BUNDLE_ID=com.zenmium.desktop`, upstream
  `MAC_TEAM_ID` cleared) and crash reporter `product_name`.
- `browser/patches/zenmium/identity-protocol.patch` - `helium://` display
  scheme becomes `zenmium://` (url_constants, url_fixer, omnibox builtin
  provider, tab_search). Internal `kHeliumUIScheme` identifier keeps its
  name; only the value changes.
- `browser/patches/zenmium/identity-icons.patch` - `chrome-product` WebUI
  glyph: helium mark to Zenmium disc placeholder.
- `platform/macos/patches/zenmium/identity-macos.patch` - product dir
  `com.zenmium.desktop`, keychain `Zenmium Safe Storage`.
- `platform/windows/patches/zenmium/identity-windows.patch` - install modes
  (company `zenmium`, product `Zenmium`, ZenmiumHTM/ZenmiumPDF ProgIDs,
  `zenmium` launch scheme), fresh product GUIDs (Zenmium owns
  `5F013A80-...`, `A4618E41-...`, `009FFECD-...`, `F7EFD333-...`), archive
  names `zenmium.7z`/`zenmium.packed.7z`/`Zenmium-bin`, `SOFTWARE\Policies\Zenmium`,
  `zenmium_installer.log`.
- Direct edits (scripts, not patch targets): `sign_and_package_app.sh`,
  `dev.sh`, `resources/dmg.json`, `devutils/generate_dmg_dsstore.sh`,
  `installer/helium.nsi` -> `installer/zenmium.nsi`, `package.py`.
- String layer: `utils/name_substitution*` regexes extended so
  Chrom(e|ium)/Helium and `chrome://`/`helium://` become Zenmium/`zenmium://`
  in .grd/.xtb; `i18n/` JSONs rewritten across all 81 locales.
- Icons: everything under `browser/resources/branding/`, `resources/favicons/`,
  `platform/macos/resources/` (`app.icns`, `Assets.car`, `legacy*.png`,
  `dmg_background.png`, `AppIcon.icon`) derived from
  `docs/zenmium/brand/zenmium-canonical.png` and the approved desktop icns.
  `product_logo.svg`, `*.icon`, and the `chrome-product` glyph are geometric
  placeholders, not the true vector mark (design review owns that).

## Patch conventions

`patches/series` is the sprint's shared file. Zenmium entries queue at the end
inside a `# zenmium` block, one file per domain, alphabetical, and are
recorded in `browser/patches/zenmium/SERIES.md`. Zenmium patches describe the
*post-helium* tree. Internal plumbing names (`HELIUM_*` version fields,
`helium.services` pref keys, `helium-chromium` path, `___helium_*` functions,
upstream copyright headers) stay; only user-visible values change.

## Build lanes

- `.github/workflows/browser-macos.yml` - `macos-15-xlarge`, clone via
  `retrieve_and_unpack_resource.sh -g`, `patch --dry-run --fuzz=0` gate on
  every series entry (browser then platform), toolchain fetch, real apply,
  substitutions, `gn gen` (ci args), `chrome/installer/mac`, ad-hoc
  `sign_and_package_app.sh`, DMG artifact `zenmium_macos_<arch>`, launch
  smoke (`--version`, `CFBundleIdentifier == com.zenmium.desktop`).
- `.github/workflows/browser-windows.yml` - `windows-2025`, SDK
  10.0.28000.0, `clone.py -o build\src -p win64`, same dry-run gate,
  `build.py --ci` (skips refetch, 5.5h budget), `package.py` (NSIS
  `zenmium_<ver>_x64-installer.exe`, mini-installer, portable zip), smoke
  check on `Zenmium-bin\chrome.exe` product name.
- Both workflows are `paths:`-scoped to `browser/**`, their platform tree, and
  themselves; `concurrency` cancels superseded runs, capping one build
  attempt per push batch. `desktop.yml`, `macos-release.yml`, and
  `windows-release.yml` are untouched.

## Local verification surface

Any local launch or UI verification of a Zenmium build runs on the side
monitor, never the primary display. Primary is the MSI G27C5 (TP's working
screen); the test surface is the DELL P2422H portrait display (non-primary).
Place verification windows on the non-primary display via
`screen.getAllDisplays()` and present them inactive (`showInactive()`) —
never `show()`/focus(). `desktop/scripts/verify-side-monitor.mjs` is the
detector: exit 0 means the Dell is present, exit 2 means do not open
windows. If the side monitor is absent, record the proof gap instead of
opening anything on main.

## Deliberately not done (track boundaries)

- Service endpoints (`services.helium.imput.net`, `crash.helium.computer`,
  `updates.helium.computer`, Sparkle/WinSparkle wiring) - T4 scope; untouched.
- `helium/hop/` still builds - it is a policy provider, not the greeting.
  `onboarding-page.patch` is unwound by T2 (`ui-onboarding-remove.patch`).
- Real code signing + notarization - deferred to the release gate; CI ships
  ad-hoc.
- Upstream staged/resume CI choreography - T1 ships a single-job lane;
  revisit if a full build overruns the job limit.

## Remaining risk

Patch context lines were verified against upstream patch output (the
post-helium tree), not against a real Chromium checkout - that tree only
exists after the ~100 GB source fetch, so first proof is the dry-run gate in
CI itself.

## T2 - Zenmium chrome UI

Five `ui-*.patch` files under `browser/patches/zenmium/` (entries + seam notes
in `browser/patches/zenmium/SERIES.md`) plus `browser/resources/zenmium/`
(manifest + canon token reference; no assets copied yet).

### Seam map

| Zenmium surface | Helium seam it rides |
|---|---|
| Sidebar (vertical tabs) | `helium.browser.layout` pref -> `kVertical` is the shipping default; upstream `VerticalTabStripRegionView` + `vertical_tab_strip_bottom_container` provide top buttons, tabs, foot buttons in spec order |
| Compact mode | Helium zen-mode auto-hide: `kHeliumZenMode=true`, `ZenModeSidebarPinned=false` (sidebar floats off-canvas, edge reveal), `ZenModeTopChromePinned=true` (toolbar stays). Operator config: compact ships ON at first launch |
| Liquid-glass frame | `kHeliumNativeFrameMaterials` enabled by default (feature flag + `helium.browser.native_frame_materials` pref); flat-tint law via overlay alphas so vibrancy stays behind a near-flat theme tint (macOS). Windows/Linux frames are theme-token driven, no material API needed |
| Zenmium palette | `ref_color_mixer.cc` baseline palette: Primary ramp = workspace green (#6ee7a8 at Primary80), Neutral/NeutralVariant overridden for both modes (charcoal dark #101214/#16191c/#e7e9ec, warm-neutral light #eeefed/#fafbf9/#272927). Accent vars (`--helium-blue`, `google-blue-*`, `kGoogleBlue*`, theme-picker baselines) -> green; internal names stay upstream |
| Sidebar geometry | expanded 230px, collapsed rail 60px (48 content + 2x6 padding), row height 36, tab min width 48, content card gutter 8, card radius 10 |
| Greeting animation | dead: `ui-onboarding-remove.patch` unwinds chrome://setup end to end; first launch lands in the browser window |

### Parity notes (Electron lane -> Helium lane)

- Compact mode: Electron compact = fixed off-canvas sidebar, hover reveal
  0.25s/0.15s, edge zones. Helium zen-mode = 6px edge trigger, 200ms reveal
  slide, 3000ms/150ms exit grace, FAST_OUT_SLOW_IN_3. Reduced motion: zen-mode
  animates via `gfx::Animation::RichAnimationDuration`, which honors
  `PrefersReducedMotion()` -> reduced-motion behavior preserved by the seam,
  no Zenmium code needed.
- Keyboard: Helium ships `kVerticalCollapseShortcut` (sidebar collapse
  toggle) + `IDC_BROWSER_LAYOUT_*` commands; spec's keyboard parity is
  satisfied by the native command layer (remap lives in settings, not
  patches).
- Url bar: Zenmium rides the native omnibox. `kHeliumCenteredLocationBar`
  pref + `kHeliumCompactLocationWidth` stay user-facing Helium options;
  colors come from the token ramp (location-bar bg already translucent
  pearl, alpha 0xCC dark / theme tint).
- Zenmium right click: Electron `CHROME_IPC {kind:"tab-menu"}` custom menu
  -> Chromium native tab context menu plus Helium's `IDC_BROWSER_LAYOUT_MENU`
  layout submenu (classic/compact/vertical/vertical-right/dynamic). No
  custom menu code ported; parity = native menu + layout submenu.
- Workspaces / essentials / folders: approximated by native tab groups,
  pinned tab section, and the upstream bottom container respectively - no
  custom layout surgery in T2; true DOM-order parity (top buttons ->
  nav-bar -> titlebar grid -> tabs -> foot buttons) is already what the
  upstream vertical strip renders.
- Frameless mode stays a user-facing Helium option (unchanged).

### GoalpostOnboarding death record

Electron `GoalpostOnboarding` (first-run greeting, profile-name + extension
pickers) has no counterpart on the Helium lane: `ui-onboarding-remove.patch`
deletes the four onboarding WebUI files and unwires every seam; Helium's
`chrome://setup` host, pak, resource ids, settings pending-notice and
strings are gone. The Electron file remains in `desktop/**` (frozen lane)
but is dead product. Residue: `deps.ini [onboarding]` may still download the
`components/helium_onboarding` tarball at fetch time - inert files, no GN
target references them; removing the dep entry is a fetch-hygiene nit left
for unification (deps.ini is a vendored non-src file, outside patch reach).

### Proof status (T2)

Patch syntax verified locally: every `ui-*.patch` passes `git apply --stat`,
and every `-`/context anchor was mechanically checked against the post-helium
patch output for the touched file. `git apply --check --directory=src` and
the screenshot gate (1440x900 + 1280x800, light/dark, compact on/off) need a
real Chromium tree + build - first proof is the CI dry-run gate, then a
built artifact; any local launch smoke runs on the DELL P2422H per the local
verification surface rule. `desktop/scripts/verify-side-monitor.mjs` was not
run: no launch verification happened this session.
