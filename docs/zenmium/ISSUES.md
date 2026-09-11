# Zenmium issue slate

Every item below is a ticket with a recommended fix and a proof. Sources: the confirmed
`r/ArcBrowser` thread for Mori (`reddit.com/r/ArcBrowser/comments/1u94qnt`, 111 comments),
Mori GitHub issues #1, #2, #5, #8 and PRs #1, #4, #6, the derived `redclayai/millie` PR history,
and Electron's official extension documentation. Fixes are for Zenmium only.

Status legend: planned / in progress / verified. All are planned at this time.

## Extensions and app windows

| ID | Ticket | Recommended fix | Proof |
| --- | --- | --- | --- |
| ZEN-001 | Electron supports only a subset of `chrome.*` APIs | Publish an enforced compat matrix; unsupported calls fail closed `{ ok, status, reason }`; never claim greater parity | Matrix test suite over a pinned extension set |
| ZEN-002 | Electron cannot load `.crx`; only unpacked dirs | CRX sideload pipeline: download, verify id, unzip to a managed dir, `loadExtension` at boot, persist | Sideload 1Password-style and Grammarly-style extensions; survive restart |
| ZEN-003 | Chrome Web Store "install" flow absent | Provide an in-app install-from-store flow that fetches and unzips the CRX, allowlisted by extension id; document the difference from Chrome | Install a pinned store extension end to end |
| ZEN-004 | `chrome.bookmarks`, `nativeMessaging`, `declarativeNetRequest` unsupported | Own bookmarks and request filtering in product code; do not expose the APIs; provide documented replacements | Bookmarks and a real blocker work in-product |
| ZEN-005 | MV2 background supported, MV3 service worker not documented | Pin an engine version; test both manifest generations; state the supported generation in the matrix | MV2 and MV3 sample extensions both load |
| ZEN-006 | Sideloaded extensions can be re-disabled after updates | Stop re-adding `DISABLE_PERMISSIONS_INCREASE`; auto-reenable trusted unpacked ids after update | Update build; trusted extensions stay enabled |
| ZEN-007 | Widevine/DRM absent in ungoogled and unclear in Electron | Decide explicitly: bundle Widevine under license, or document DRM streaming unsupported and fail gracefully | Netflix/Spotify page behaves predictably |

## Security

| ID | Ticket | Recommended fix | Proof |
| --- | --- | --- | --- |
| ZEN-008 | Prompt injection: page content drives the agent to exfiltrate, rewrite the search template, or open `file://` | Treat page as untrusted data; capability-scoped tools; URL-scheme allowlist; search-template integrity; explicit approval for navigation and local files; egress allowlist; structured outputs | Injection corpus fails closed |
| ZEN-009 | Plaintext passkey key material and missing rpId public-suffix check (Mori audit) | Do not store raw key blobs; use native WebAuthn/OS keychain; validate rpId suffix | Security recipe passes; no plaintext keys on disk |
| ZEN-010 | Unauthenticated local agent server (Mori audit) | Bind localhost, require a per-boot token, per-client consent | External process is rejected |
| ZEN-011 | Automation reads leak URLs/form values; unbounded inputs | Redact query, fragment, and credentials; cap page-text, wait, scroll, and coordinate inputs | Redaction and bounds unit tests |
| ZEN-012 | Assistant enabled by default raises the security posture (Mori PR #4) | Ship the agent off by default; explicit enable with a clear explanation | Fresh profile has the agent off |
| ZEN-013 | CRX install from attacker-controlled fallback URL (Mori audit) | Validate CRX id against the expected id; remove attacker-controlled fallback | Negative install test rejected |
| ZEN-014 | Ad-block control was a non-functional stub advertised as active (Mori/Millie) | Wire a real blocker engine or remove the control; fail closed | Toggle blocks a known ad domain |
| ZEN-015 | Dependency and secret drift, no SBOM | Renovate with age gates; OSV/Grype scanning; Semgrep; gitleaks; Syft SBOM per release | CI artifacts present per release |

## Stability and UX

| ID | Ticket | Recommended fix | Proof |
| --- | --- | --- | --- |
| ZEN-016 | Quit crashes with `SIGSEGV` (Mori #8) | Fix application teardown ordering; add crash telemetry | Quit 20 times cleanly |
| ZEN-017 | Cannot delete a Space (Reddit) | Implement delete with confirmation and tab reassignment | Interaction receipt |
| ZEN-018 | Empty tab folders are not persisted (Mori #1) | Persist folders regardless of contents | Relaunch retains an empty folder |
| ZEN-019 | Crash on launch when the assistant dependency is missing (Mori #2) | Make the agent optional; clear, actionable error state | Launch without the agent succeeds |
| ZEN-020 | Non-Views window defects: context menu, save-password crash, downloads TCC path, external links, hardcoded About (Millie PRs) | Fix each with regression tests | Per-item receipts |
| ZEN-021 | Build docs mixed legacy CEF and git-lfs confusion (Mori #5, PR #6) | Write a single accurate build guide for the Electron shell | Clean clone builds in Cloud |
| ZEN-022 | Multi-profile per Space requested (Reddit) | Partition sessions and storage per profile; keep spaces within a profile | Two profiles isolated |
| ZEN-023 | Arc keyboard map and overflow controls requested | Implement the documented Arc shortcuts and overflow menu | Shortcut test matrix |
| ZEN-024 | Windows and Linux requested (Reddit, Mori #7) | Defer; design the shell cross-platform from day one | Backlog |

## Rejected

| Request | Reason |
| --- | --- |
| WebKit-based variant (Reddit) | Conflicts with the Chromium core and Chrome-extension goal |
| Full Chrome Web Store parity in v1 | Electron cannot provide it; tracked as ZEN-001/003 with the `BrowserCore` v2 path, not promised |
| Panel UI as a component source | React Native/Expo; not in the approved stack; dropped by decision D8 |
