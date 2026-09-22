# Zenmium patch conventions

Zenmium-owned patches live in `patches/zenmium/` and are queued at the end of
`patches/series` inside the `# zenmium` comment block. They apply on top of
the upstream Helium patch set (helium/* entries apply first), so a Zenmium
patch's `-` context lines describe the *post-helium* tree.

## Rules

- One file per domain, alphabetical within the zenmium block.
- `patches/series` is the sprint's shared file: record every intended entry in
  this file first, then add the line to series. Unification owns the merge if
  two tracks queue entries in the same window.
- Never edit an upstream patch under `helium/` or `ungoogled-chromium/` in
  place; overlay it with a zenmium patch so upstream trees stay byte-identical
  and rebases are mechanical.
- Keep context lines small and anchored on lines the upstream patch wrote;
  that keeps `git apply --check` deterministic in CI before a full source pull.
- Internal identifiers that are not user-visible keep their upstream names
  (e.g. `kHeliumUIScheme`, `helium.services` pref keys, `HELIUM_VERSION_STRING`
  plumbing). Only the *values* change to Zenmium; renaming plumbing buys
  nothing and multiplies merge risk at rebase.

## Entries

| patch | domain | what it does |
|---|---|---|
| `identity-branding.patch` | identity | BRANDING file (PRODUCT_*=Zenmium, MAC_BUNDLE_ID=com.zenmium.desktop, clears upstream MAC_TEAM_ID) and crash reporter product_name |
| `identity-icons.patch` | identity | chrome-product WebUI glyph: Helium mark path -> Zenmium disc placeholder (canonical raster is the source of truth; true vector mark is a design review item) |
| `identity-protocol.patch` | identity | helium:// display scheme -> zenmium:// (url_constants, url_fixer, builtin_provider omnibox, tab_search) |
| `services-endpoints.patch` | services | imput/helium service hosts -> Solvys Fly lane (kHeliumDefaultOrigin + settings placeholder -> zenmium-services.fly.dev, kUpdateBaseUrl -> zenmium-updates.fly.dev, crash URL -> zenmium-svc-crash.fly.dev, set_ping_enabled_domain -> zenmium-services.fly.dev); swap *.fly.dev for the final hostname at the TP DNS gate |
| `ui-frame-liquid-glass.patch` | chrome UI | liquid-glass frame on Helium's native-materials seam: kHeliumNativeFrameMaterials enabled by default (feature + pref); flat-tint law via overlay alphas (neutral 0.2->0.12, theme tint 0.55/0.8->0.88/0.9) so the macOS vibrancy layer sits behind a near-flat tint; Windows/Linux frames are theme-token driven (no API seam), documented in S005-HELIUM-BASE |
| `ui-onboarding-remove.patch` | chrome UI | removes helium-onboarding end to end: deletes chrome/browser/ui/webui/onboarding/* (4 files), unwires chrome://setup (url constants, WebUI config, source_set, resource ids, paks, generated_resources part, gritdeps), restores upstream startup/favicon/incognito/search-engines checks, drops the services-page setup-pending surface + strings + allowlist entry; keeps kHeliumDidOnboarding + kHeliumServicesConsented registered (default true) and reverts ShouldAccessServices to `return enabled` so services run with no consent ceremony |
| `ui-sidebar-zenmium-defaults.patch` | chrome UI | Zenmium chrome defaults: helium.browser.layout -> kVertical (sidebar is the shipping layout); Zenmium compact mode on at startup via kHeliumZenMode=true + ZenModeSidebarPinned=false + ZenModeTopChromePinned=true (floating sidebar, pinned toolbar, edge-reveal); reduced-motion preserved (zen-mode reveal uses RichAnimationDuration) |
| `ui-sidebar-zenmium-geometry.patch` | chrome UI | ZEN_SIDEBAR_SPEC geometry: expanded strip 200->230px, collapsed rail 42->60px (48px content + 2x6 padding), tab/pinned row height 30->36, min tab width 30->48, content card gutter kSplitViewContentInset 3->8, card corner radius GetGenericFrameRadius 8->10 |
| `ui-theme-zenmium-tokens.patch` | chrome UI | Zenmium canon into the Chromium color pipeline: Primary ramp -> workspace green (#6ee7a8 anchored at Primary80), Neutral + NeutralVariant ramp overrides appended for both color modes (charcoal dark, warm-neutral light), kGoogleBlue* ramp + cr_shared_vars.css/app.css accent vars + theme-picker baseline swatches -> green; internal names stay upstream (--helium-blue, google-blue-*) |

## Track notes

- T2 (UI): `helium/hop/` stays (it is a policy provider, not the greeting).
  `onboarding-page.patch` is unwound by `ui-onboarding-remove.patch` (T2):
  chrome://setup, its WebUI controller, source_set, pak, resource ids and
  settings-page pending surface are all removed; the onboarding component
  itself may still download via deps.ini [onboarding] (inert residue, not
  referenced by any target) - documented in S005-HELIUM-BASE.md.
  Compact-mode note: Zenmium compact = Helium zen-mode with
  sidebar_unpinned + top_chrome_pinned (see ui-sidebar-zenmium-defaults).
- T4 (services): upstream endpoints (services.helium.imput.net,
  crash.helium.computer, updates.helium.computer) are untouched in T1. If a
  patch here ever needs an endpoint before T4 lands, use the
  `*.zenmium.internal` placeholder convention, never imputnet hosts.
