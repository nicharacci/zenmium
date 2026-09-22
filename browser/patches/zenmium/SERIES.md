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

## Track notes

- T2 (UI): `helium/hop/` and `onboarding-page.patch` still build by default;
  removing or rewiring them is T2 scope, recorded here when it happens.
- T4 (services): upstream endpoints (services.helium.imput.net,
  crash.helium.computer, updates.helium.computer) are untouched in T1. If a
  patch here ever needs an endpoint before T4 lands, use the
  `*.zenmium.internal` placeholder convention, never imputnet hosts.
