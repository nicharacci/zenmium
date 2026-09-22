# Provenance: platform/windows

Vendored clone of imputnet/helium-windows (not a fork; free to diverge).
- Upstream: https://github.com/imputnet/helium-windows
- Pin: tag 0.17.2.2
- Resolved commit: a3a181707825c2c5117a96655cbc09a35beebe4a
- Vendored: 2026-09-22 by S005/T1
- Submodule helium-chromium (imputnet/helium) replaced by the vendored
  ../../browser tree via the `helium-chromium` symlink; upstream `.gitmodules`
  was removed at vendor time.
- Vendored `.github/` and `docs/` are upstream's own and do not run here;
  they are kept as provenance only.
- Zenmium divergence: patches under `patches/zenmium/`, `installer/helium.nsi`
  renamed to `installer/zenmium.nsi` (new product GUIDs), and `package.py`
  artifact names rebranded; see docs/zenmium/S005-HELIUM-BASE.md.
