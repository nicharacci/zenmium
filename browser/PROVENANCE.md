# Provenance: browser/

Vendored clone of imputnet/helium (not a fork; free to diverge).
- Upstream: https://github.com/imputnet/helium
- Pin: tag 0.17.2 (2026-09-17), Chromium 153.0.8010.52, helium revision 2
- Resolved commit: 8c19f4c6d624e31293bca13e655f2fe542ba6fdb
- Vendored: 2026-09-22 by S005/T1
- Licenses: LICENSE + LICENSE.ungoogled_chromium retained
- Note: upstream consumers reach this tree where platform repos expected the helium-chromium submodule (which pointed here).
- Divergence log lives in git history + docs/zenmium/S005-HELIUM-BASE.md. Zenmium-owned patches sit under patches/zenmium/ and queue at the end of patches/series (see patches/zenmium/SERIES.md).
- Removed at vendor time: AGENTS.md + CLAUDE.md (upstream contributor policy that forbids agent edits; inert here but would block T2/T3/T4 lanes — recorded as intentional divergence).
- Direct-edit divergence: utils/replace_resources.py now creates parent directories for nested resource destinations (os.makedirs before copyfile). Upstream only copied flat files; the zenmium_internal extension ships pairing/ dock/ icons/ subdirs. One-line robustness fix, no behavior change for flat paths. (S005, run 35790036058)
