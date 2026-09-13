# Security dependency notices

## Ghostery Electron blocker

Zenmium includes `@ghostery/adblocker-electron` 2.18.2 and its Ghostery dependencies, licensed under the Mozilla Public License 2.0. The package's complete copyright/license notice is reproduced without changes in `ghostery-MPL-2.0.txt`. The installed Ghostery library source is not modified by Zenmium's integration.

- Upstream source: https://github.com/ghostery/adblocker/tree/c4c20aa63e3a72113f66777cf35a3f58877a36ee
- Electron wrapper source: https://github.com/ghostery/adblocker/tree/c4c20aa63e3a72113f66777cf35a3f58877a36ee/packages/adblocker-electron
- Zenmium integration source: https://github.com/nicharacci/zenmium

Network filter data is downloaded separately from EasyList and EasyPrivacy. Those upstream lists carry their own notices and licenses; see https://easylist.to/ and https://github.com/easylist/easylist. User filter caches are not repository or release assets.

## Build and credential-scanning tools

`@electron/fuses`, Secretlint, and its recommended/1Password detection rules are development tools, not a password vault. Their package license notices remain in their installed distributions. Credential scanning is a detection layer, not a guarantee that all possible secrets can be identified.

Other existing third-party notices remain applicable, including `../THIRD_PARTY_ZEN.md`. This file does not replace those notices or imply affiliation with Ghostery, Google, Zen Browser, or 1Password.
