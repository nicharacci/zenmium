# Third-party reference: Zen Browser

Zennium's frontend reference work consults the installed Zen Browser `1.22b`, BuildID `20260904060728`, SourceStamp `c2a638b7f735c7e7d4ee22e0182c8f6a16da93e5`, with Gecko `155.0.1`. SourceRepository, as recorded in the package, is [zen-browser/desktop at that revision](https://github.com/zen-browser/desktop/tree/c2a638b7f735c7e7d4ee22e0182c8f6a16da93e5).

Evidence date: 2026-09-12. The exact archive is `/Applications/Zen.app/Contents/Resources/browser/omni.ja`; build identity is from `/Applications/Zen.app/Contents/Resources/application.ini`. `ZEN_FRONTEND_REFERENCE.md` contains member paths, source line references, behavior notes, and the reference state matrix.

## Attribution and observed notices

The inspected Zen CSS, JS, and MJS source files carry a Mozilla Public License 2.0 source-form notice. The installed `chrome/browser/content/browser/license.html` includes the complete MPL 2.0 text beginning at the `mpl` anchor (line 172), together with notices for other bundled third-party software. The license file states that most source is available under MPL 2.0 and that other components have their own licenses; this inventory does not classify every bundled dependency as MPL.

Attribution for the reference material: Zen Browser contributors and the Mozilla contributors whose browser source Zen incorporates, under the notices carried by the respective source files. Do not invent individual copyright holders or copyright years when a member has only the generic MPL notice.

The source-form notice on the inspected CSS files reads:

```text
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.
```

License reference: [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/). The installed license text and individual source notices were inspected locally; that URL was supplied by the source notice, not used as separate online verification.

## Material inventory and scope

| Material | Treatment in this documentation task |
| --- | --- |
| Zen browser styles, state selectors, measurements, and motion values | Consulted as source evidence; summarized in `ZEN_FRONTEND_REFERENCE.md`. Provenance is the full installed member, not an unversioned snippet. |
| Compact, pinned-tab, Glance, media, download, and UI manager modules | Consulted for behavior and default-versus-fallback distinctions. No module was copied into product code by this task. |
| Mozilla/Firefox browser tokens and `blanktab.html` | Consulted where Zen inherits or overrides behavior. Their MPL notices remain the attribution source. |
| Installed defaults | Used only as package configuration evidence; no user profile or browsing data inspected. |
| Source icons, logos, grain textures, images, and bundled fonts | No assets copied or added by this task. A source URL in CSS is not an asset license inventory. |
| `zen-vendor/motion.min.mjs` and other vendored dependencies | No vendored library copied. The caller's animation parameters are documented; vendor licensing is not inferred from an MPL-marked caller. |

Only this document and `ZEN_FRONTEND_REFERENCE.md` are authored by this sidecar. This is not an audit of concurrent renderer edits or a statement that all pre-existing or subsequently copied material has been inventoried.

## Provenance when material is ported

For any later source-derived CSS, module, or asset added to Zenmium, record the exact archive member, full-source hash/revision, destination path, original notice, and whether it was modified. Preserve the relevant source notice in a copied file. Keep full-source provenance for extracted curves and icons; a declaration's short length does not justify inventing a different provenance.

No asset license is established here for icons merely named in CSS. Inspect the exact SVG header and its upstream directory/license at the pinned revision before attributing a newly copied asset. Record any `context-fill`, `context-stroke`, `-moz-context-properties`, or color adaptation as a modification rather than calling the result byte-identical.

Distribution obligations and trademark permissions must be evaluated against the actual material shipped and its license; this source-reference inventory is not a completed distribution-license audit or a claim of endorsement by Zen or Mozilla.


## Full installed source versions

All entries below were hashed from the complete decompressed archive member, not from displayed excerpts. Counts are `wc -l` (newline count) and `wc -c` (bytes); SHA-256 is over the member's exact bytes, before any newline or encoding conversion. Expanded includes can carry repeated MPL headers.

The archive SHA-256 is `3351d65b5202121f3be64bee435cecc60457b79f0fcc3ff5216b5302c35e83f0`; `application.ini` SHA-256 is `b6e38078933843dc6039cc7cbeadb4e349251cc767a16d7693ba2d6fc9921cb9`.

Path prefixes match `ZEN_FRONTEND_REFERENCE.md`: `S/` means `chrome/browser/content/browser/zen-styles/`, `C/` means `chrome/browser/content/browser/zen-components/`, `B/` means `chrome/browser/content/browser/`, and `P/` means `defaults/preferences/`.

| Full source member | Lines | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `S/zen-browser-ui.css` | 354 | 8315 | `9967dfd164e01aa620fa0ca9420910b6ea54d0d809a1bcfed71045dcc98eb14d` |
| `S/zen-workspaces.css` | 729 | 17640 | `1f79df783700162991e5d2add5dac9da30a1977e9116ac13b396a21fa6117082` |
| `S/zen-split-view.css` | 451 | 10854 | `bc69bf9c747a3710132db288d747de11da27565c140c5eb66a6e72cf060e1c70` |
| `S/zen-glance.css` | 190 | 3868 | `1c618cc79fe613446d76d3b07700fbbbc532bbf29a99d03b4d2d8448fb325d5e` |
| `S/zen-tabs/vertical-tabs.css` | 1374 | 34550 | `7a59f4bfe0f46d168912bb965424590e6891cca44ae4d1fc758774924d06289d` |
| `S/zen-theme.css` | 464 | 16760 | `6446f4abd1960794191151e96fc885abbd5447fbc8ba6fd148ce4b7e0264ead5` |
| `C/ZenCompactMode.mjs` | 1115 | 36340 | `e68a82a4ab0340651c8f99c0abca317e226bd02a66bd468b39e73375e493beab` |
| `C/ZenPinnedTabManager.mjs` | 1185 | 37922 | `b3435200aefff9ac4560b62b475cc7980db0d153a8c8eb0e12d23db67d9a4589` |
| `S/zen-browser-container.css` | 88 | 2998 | `15d37eca8665bdcafc36a87a9b8fc8699f8126d11306281384c764c5d9df206c` |
| `S/zen-omnibox.css` | 751 | 19149 | `f07a0f3c445f92fd936946db8b4a3e72e943c232588282b65920c0b08bc46c21` |
| `S/zen-popup.css` | 413 | 11397 | `cf6cf4ad4c1e21ac841f9a0213f84b1cd1c87491d416eb4a868d516438fa09db` |
| `S/zen-panel-ui.css` | 59 | 2196 | `ac49f0f063b2ae541abccb53d75947c10713159be1b5ba15cc745777bd5f4a95` |
| `S/zen-compact-mode.css` | 442 | 12400 | `78b344c646716575aa7e79b2ccabffdf8d8271dca90ba5a211e7b9a1ee32bbaa` |
| `S/zen-media-controls.css` | 397 | 9385 | `68c77652595290c2a28d25ce1ff0875f16d9bde1c24e2a4c87acc8d04d172a6b` |
| `S/zen-download-box-animation.css` | 27 | 768 | `a13d88363ef548580178f1771cbf37ceccf9fc8058490d783760cba4038f1f22` |
| `S/zen-single-components.css` | 802 | 18031 | `425f32e9b5b73776c6f1aef0313ff9d4dd198db654bba7f3432728cbc897fe31` |
| `S/zen-animations.css` | 102 | 1730 | `fec57534dd3d1879171ec16a8d75b6bd0e866d6f2d81204ef793c4913edaa810` |
| `C/ZenGlanceManager.mjs` | 1961 | 55528 | `e0a30f7c44a171658e6c5f57e565e13571a0c87be41d19e80b8da24905b799b4` |
| `C/ZenMediaController.mjs` | 800 | 23070 | `8f7c9d4c804b91c4a9775019e4e62f794c418147728de6eb3b45bdf62cc2b6e5` |
| `C/ZenDownloadAnimation.mjs` | 545 | 15436 | `166f71abc1d898bbc2c0370d671c517385216b201ede78a981d5d054e5c64bb9` |
| `B/ZenUIManager.mjs` | 1797 | 57815 | `154c5a28ae2fbbb56cb25436437f02b02924302d8beec606adeabd4293176bf5` |
| `B/zenThemeModifier.js` | 209 | 6656 | `a33ac2d8e9685630d878157414563ce499702d1e83e72c4032895963a7ae4b2e` |
| `B/blanktab.html` | 15 | 451 | `6cd4349e989535f71c80a69f7c8029b369314f94096a28295ba6161db4748bca` |
| `P/firefox.js` | 1806 | 111729 | `3c68f0cfa0561d94edd913d9d7c971244345dd8623cf6b37f8810733d44d4bcd` |

Reproduce a hash with:

```sh
unzip -p /Applications/Zen.app/Contents/Resources/browser/omni.ja chrome/browser/content/browser/zen-styles/zen-compact-mode.css | shasum -a 256
```

These full-source versions are available in the installed archive. This documentation task did not vendor complete upstream source files into the repository.


Additional full members consulted for controller branches, menu markup, inherited tokens, and license notices:

| Archive member | Lines | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `chrome/browser/content/browser/urlbar/UrlbarInput.mjs` | 6771 | 230461 | `52a742fa618ceb0060db6077fa5897af926d1895075c6e5edf7482bd8866f0d1` |
| `chrome/browser/content/browser/browser.xhtml` | 7711 | 377622 | `f74b33cd7a05950a3a0581fd47463e44fe46ab7283358e249488b21f2cef30cc` |
| `chrome/browser/content/browser/license.html` | 5761 | 306914 | `1ab44ce466d28331289a4a2dda53244f03a849205ab84bc0d597f7584cfe8c73` |
| `chrome/browser/skin/classic/browser/tabbrowser/tab.tokens.css` | 173 | 10163 | `c1d7d28ab7e8525157bbc06b6368a5ac49cf2e07ede2504c0cbdcf263edee4fd` |

## Append-only installed-reference drift receipt: 1.22.1b

Measured at `2026-09-12T22:11:01.466Z` (UTC), after main reported an automatic application update during a new clean-profile launch. This sidecar verified package files only; it did not operate UI, observe the update process, or read any browsing profile. The earlier tables and package hashes remain the **1.22b baseline**, unmodified.

Current `application.ini`: version `1.22.1b`, BuildID `20260911034930`, SourceStamp `d7441097171a1a9d47ee40a3e6fcd71bd01784a4`, Gecko min/max `155.0.1`; SourceRepository remains `https://github.com/zen-browser/desktop`.

| Current package evidence | Measured value |
| --- | --- |
| Archive | `/Applications/Zen.app/Contents/Resources/browser/omni.ja` |
| Archive bytes | 111428691 |
| Archive SHA-256 | `2f24fd29a1be8fe9e81576bcba6b4314418cf55849662b86dd53ca757e030508` |
| application.ini SHA-256 | `347d5525259d4f129598f6c56f63ede68c89658398d21d7dbd3176c02d45dec4` |
| Read consistency | Both package hashes were identical before and after all member extractions. |

Comparison covered all **28 baseline member records** above. Each current member was read in full with `unzip -p`; SHA-256, bytes, and newline counts were recomputed directly from its returned bytes. All extractions returned nonempty members with the known optimized-archive warning/exit code 2. **15 members changed; 13 are byte-identical.** This is a byte-identity comparison, not a semantic source diff or a new visual-parity measurement.

### Changed baseline members

Seven Zen stylesheets changed: workspace, Glance, vertical tabs, theme, browser container, panel UI, and compact mode. Six controller/module files changed: compact mode, pinned tabs, Glance, UI manager, theme modifier, and URL-bar input. Packaged preferences and browser markup also changed.

| Member | Baseline → current lines | Baseline → current bytes | 1.22.1b SHA-256 |
| --- | --- | --- | --- |
| `S/zen-workspaces.css` | 729 → 729 | 17640 → 17557 | `6863627e505c564af426d20f7b66d8fd49beb98e1fe987740624be95eec7ad6f` |
| `S/zen-glance.css` | 190 → 200 | 3868 → 4356 | `93006c55afe5e16f2a18d19ebdda4061c9f71abf8f4e971b8b47369cf476f384` |
| `S/zen-tabs/vertical-tabs.css` | 1374 → 1373 | 34550 → 34524 | `f07d747564a268870b42f3b40a9e6a68085ab86778b8bfd007061d95bbf5ea1f` |
| `S/zen-theme.css` | 464 → 547 | 16760 → 19106 | `53ff91d9462ec97066e57f56050da38868ae08c286b638c22d3c560e34ac3486` |
| `C/ZenCompactMode.mjs` | 1115 → 1115 | 36340 → 36359 | `005594b7a2939b741ac6707322729d5107eaad0ba5787c1e63a3de5afc23a165` |
| `C/ZenPinnedTabManager.mjs` | 1185 → 1185 | 37922 → 37930 | `e6ca26fdebbe497ded9ebee5718be276ca9bd19142c01658d52f04cd1f9353a2` |
| `S/zen-browser-container.css` | 88 → 94 | 2998 → 3337 | `b5bc1d68ed61c61712c00be66b87e779f36842fef67498a8d18fb54d77f20d49` |
| `S/zen-panel-ui.css` | 59 → 66 | 2196 → 2442 | `59beb1d94717a188245c41ad1c4f7411961538796d86fcb372e46e4bf4260f6e` |
| `S/zen-compact-mode.css` | 442 → 442 | 12400 → 12372 | `b567ee5e8eb8970eb413610683dcc476ee04a81e5330857cf43ca49dabdeb042` |
| `C/ZenGlanceManager.mjs` | 1961 → 1961 | 55528 → 55528 | `61619de9ca4661d53ef261e3a68992ac8286369533de0f833c1c6b4c071bf9f3` |
| `B/ZenUIManager.mjs` | 1797 → 1805 | 57815 → 58207 | `d7a8e520f50b62708e97ba70f4083fdd02611ce93281d20b745761a44c5b60d9` |
| `B/zenThemeModifier.js` | 209 → 209 | 6656 → 6656 | `6ccabeaaae9cd8052940a9854927d3bde223ea730510a5cfae734dbc5bfd41c9` |
| `P/firefox.js` | 1806 → 1813 | 111729 → 112100 | `35af18701de3b464410310192061519efe05fc3c9f9f4b4dc70d4226d419a7f2` |
| `B/urlbar/UrlbarInput.mjs` | 6771 → 6774 | 230461 → 230555 | `961cb965598e283c3048d5840eadb9013bd5299e3b672d0edb9681cdb31aaf11` |
| `B/browser.xhtml` | 7711 → 7716 | 377622 → 377951 | `bc45f0cc331610f61e3e3f37a81eb0134154388dbb912d724e9f5afc111584d3` |

Equal line/byte counts do not establish identity: `C/ZenGlanceManager.mjs` and `B/zenThemeModifier.js` changed hashes despite unchanged sizes. Do not infer unchanged behavior or transfer old line-specific claims from size alone.

### Byte-identical baseline members

The following 13 current members match the baseline SHA-256, byte count, and newline count exactly; their hashes remain in the original tables:

- `S/zen-browser-ui.css`
- `S/zen-split-view.css`
- `S/zen-omnibox.css`
- `S/zen-popup.css`
- `S/zen-media-controls.css`
- `S/zen-download-box-animation.css`
- `S/zen-single-components.css`
- `S/zen-animations.css`
- `C/ZenMediaController.mjs`
- `C/ZenDownloadAnimation.mjs`
- `B/blanktab.html`
- `B/license.html`
- `chrome/browser/skin/classic/browser/tabbrowser/tab.tokens.css`

### Keyboard addendum and evidence boundary

The separately recorded keyboard addendum member `C/ZenKeyboardShortcuts.mjs` is also byte-identical to that addendum's hash: 1656 lines / 45330 bytes / SHA-256 `ffd644eb8a9578896ae4f003418a8d4559a2e64fbe8ff33b278c82e627dd5637`. It was not one of the original 28 inventory rows, so it is not included in the 15/13 totals. This corroborates the keyboard addendum against the current package without backdating its capture to the initial baseline inventory.

The original process/source captures remain labeled **1.22b / c2a638b7f735c7e7d4ee22e0182c8f6a16da93e5**. Any subsequent clean-profile captures from the updated package must be labeled **1.22.1b / d7441097171a1a9d47ee40a3e6fcd71bd01784a4**. The earlier statement that full baseline versions are available in the installed archive was true at baseline inspection; the current archive path no longer reproduces the 15 changed baseline members. Do not overwrite baseline hashes, silently relabel earlier captures, or claim unchanged presentation from the 13 matching members. Native/UI verification remains owned by main.
