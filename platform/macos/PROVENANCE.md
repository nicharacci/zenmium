# Provenance: platform/macos

Vendored clone of imputnet/helium-macos (not a fork; free to diverge).
- Upstream: https://github.com/imputnet/helium-macos
- Pin: tag 0.17.2.2
- Resolved commit: 359e3c5711a7c727499948bc9413aedabe3295ae
- Vendored: 2026-09-22 by S005/T1
- Submodule helium-chromium (imputnet/helium) replaced by the vendored
  ../../browser tree via the `helium-chromium` symlink; upstream `.gitmodules`
  was removed at vendor time.
- Vendored `.github/` and `docs/` are upstream's own and do not run here;
  they are kept as provenance only.
- Zenmium divergence: patches under `patches/zenmium/`, `sign_and_package_app.sh`,
  `resources/dmg.json`, `dev.sh`, `devutils/generate_dmg_dsstore.sh`, and
  `resources/` assets rebranded; see docs/zenmium/S005-HELIUM-BASE.md.
