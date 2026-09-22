# Intended series entry (staged, T1-dependent)

`browser/` is not on this checkout (T1 in flight), so the patch and its series registration live here until the unification merges tracks.

## Patch

- File: `services/pending/services-endpoints.patch`
- Intended landing path: `browser/patches/zenmium/services-endpoints.patch`
- Intended series entry (appended to `browser/patches/series` after the helium group — ordering owned by unification, do not merge into `patches/series` here):

```
# S005/T4 solvys services
zenmium/services-endpoints.patch
```

## Ordering

Must apply AFTER the helium core patch group, because it edits constants those patches create:

- `helium/core/services-prefs.patch` (creates `kHeliumDefaultOrigin`, `services_page.html` placeholder)
- `helium/core/add-updater-preference.patch` (creates `kUpdateBaseUrl` in `helium_services_helpers.cc`)
- `helium/core/crash-reporting-prefs.patch` (creates the crash upload URL)
- `helium/core/proxy-extension-downloads.patch` (sets `set_ping_enabled_domain`)

All hunks were authored against those patches' post-state, so the patch applies cleanly on top of them (context lines verified against helium @ pin). Regenerate by diffing a patched tree if any of those upstream patches drift.

## Do not touch (per brief)

- `browser/patches/series` ordering belongs to unification; this file only records the intended entry.
- The dummy origin `https://helium-services-are-disabled.qjz9zk` stays: it is a non-routable placeholder, not a phoned-home endpoint.
