# Chromium Web Store helper

This directory vendors the unmodified `Chromium Web Store` CRX from
NeverDecaf's open-source project so Zenmium can offer Chrome Web Store
installation affordances inside each persistent Workspace profile.

- Upstream: https://github.com/NeverDecaf/chromium-web-store
- Pinned source revision: `207fded21203b686896d8ab1b6d1ce818770a0fa`
- Pinned helper extension id: `ocaahdebbfolfmndjeplogmgcagdmblk`
- Pinned package SHA-256: `63c075b4a25b11af2c536dad191946e8d9547f92d5b6c257b2ce4138d2996f32`

Zenmium verifies the CRX identity before unpacking and loads it through the
Workspace's persistent Electron session. The helper is supplemental: Zenmium's
Extensions panel also has a direct, verified Web Store package installer because
Electron supports unpacked extensions rather than Chrome's native CRX installer.

The upstream package is distributed under the MIT license; see `LICENSE`.
