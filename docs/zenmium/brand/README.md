# Zenmium canonical logo

`zenmium-canonical.png` is the single approved source artwork for Zenmium. The user designated this exact image final on 2026-09-13. It supersedes every previous generated logo draft.

- SHA-256: `456dcbf8455d9ad03bf094f6a07eca6c02cfc0a9655a7302ad8f42f821fb45db`
- Source: `exec-1192a031-0019-4ceb-9f55-89cf549fd664.png`
- Dimensions: 1254 × 1254 pixels; RGB PNG.
- Appearance: three polished green blades, smoky-gray center, neutral pearl ring, smooth recessed seams, no dither.

Preserve the approved artwork and colors. Do not substitute or regenerate an earlier draft. Favicon and macOS icon exports derive from this artwork and remain consistent with it. They are format derivatives, not additional design candidates.

The canonical source retains its black exterior so the approved artwork stays byte-stable. Runtime icon derivatives apply transparency only outside the circular insignia: `desktop/src/renderer/public/zenmium-favicon.png` is the 512px browser fallback and `desktop/build/icons/zenmium.icns` is the macOS bundle icon. `zenmium-favicon.svg` is an SVG container around the approved raster, not a claim of true vectorization; a true vector version would require independently authored vector paths and would be a separate design review.

SHA-256 derivatives:

- `desktop/src/renderer/public/zenmium-favicon.png`: `d9b2319c34d03d5351df7d1735427d28a2d75a5b7c8577479699123c2e024f49`
- `desktop/src/renderer/public/zenmium-favicon.svg`: `80182c0041cd9f46943863d597ac1f89c5968d33f4ce2c1a0f76ddef685fb400`
- `desktop/build/icons/zenmium.icns`: `690d7c16dde63f9b27048394d00058d9a393346a1f4e0b3a940bc7cd0c1952ec`

The renderer declares both favicon formats and the macOS packaging configuration points to the ICNS asset. Commit, merge, and publishing remain subject to the native verification, security, signing, and protected-branch gates in `../SPRINT-V0.0.1.md`.
