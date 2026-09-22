# browser/resources/zenmium

Zenmium-owned resources for the Helium browser tree. Files placed here are
copied into the Chromium `src/` tree during the resource-replacement step
(`utils/replace_resources.py`), keyed by `zenmium_resources.txt` using the
same `source dest` line format as `helium_resources.txt`.

## What lives here today

- `zenmium-tokens.css` — reference sheet for the canon values the
  `ui-theme-zenmium-tokens.patch` maps into Chromium's color pipeline.
  Documentation only; not consumed by the build.

## Svelte / WebUI seam status

Helium's only Svelte WebUI surface was `chrome://setup` (helium-onboarding).
T2 removes it entirely (`ui-onboarding-remove.patch`), so there is no
Helium-owned Svelte surface left to restyle. Zenmium-owned WebUI surfaces
arrive with T3 (internal products contract); Phosphor icon assets and any
Zenmium WebUI bundles get manifest entries here at that point.

## Manifest

`zenmium_resources.txt` is intentionally empty (header comments only). Add
entries as `relative/path-under-zenmium  src/path/to/target` when a real
asset ships.
