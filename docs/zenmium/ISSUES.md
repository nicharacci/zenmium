# Zenmium issue slate

Every item is a ticket with a recommended fix and a proof. Sources: the confirmed `r/ArcBrowser` thread for Mori (`reddit.com/r/ArcBrowser/comments/1u94qnt`, 111 comments), Mori GitHub issues #1, #2, #5, #8 and PRs #1, #4, #6, the derived `redclayai/millie` PR history, and ungoogled-chromium behavior. Fixes are for Zenmium only.

Status: all planned.

## Extensions and app windows

| ID | Ticket | Recommended fix | Proof |
| --- | --- | --- | --- |
| ZEN-001 | Chrome Web Store "Add to Chrome" is greyed because ungoogled-chromium strips `chrome.webstorePrivate` | Re-enable the private API in the fork, or inject an in-page installer that routes to a local CRX installer, allowlisted by extension id | Install 5 pinned store extensions; the button works |
| ZEN-002 | Extension support is undefined against real Chrome | Publish and enforce a compat matrix; unsupported calls fail closed `{ ok, status, reason }`; never claim greater parity | Matrix test suite over a pinned extension set |
| ZEN-003 | Sideloaded extensions are re-disabled after every update (`DISABLE_PERMISSIONS_INCREASE`) | Stop re-adding the disable reason on update; auto-reenable trusted unpacked ids | Update build; trusted extensions stay enabled |
| ZEN-004 | CRX install from an attacker-controlled fallback URL with the gallery-install flag | Validate the CRX id against the expected id; remove the attacker-controlled fallback | Negative install test rejected |
| ZEN-005 | Manifest V2 deprecation removes uBlock Origin and similar | Support MV3 and a maintained content-blocker engine | Blocklist test page |
| ZEN-006 | Widevine and DRM are removed by ungoogled | Bundle Widevine under license, or document DRM streaming unsupported and fail gracefully | Netflix or Spotify page behaves predictably |
| ZEN-007 | Ad-block control was a non-functional stub advertised as active | Wire a real blocker engine or remove the control; fail closed | Toggle blocks a known ad domain |

## Security

| ID | Ticket | Recommended fix | Proof |
| --- | --- | --- | --- |
| ZEN-008 | Prompt injection: page content drives the agent to exfiltrate, rewrite the search template, or open `file://` | Treat the page as untrusted data; capability-scoped tools; URL-scheme allowlist; search-template integrity; approval for navigation and local files; egress allowlist; structured outputs | Injection corpus fails closed |
| ZEN-009 | Plaintext passkey key material and a missing rpId public-suffix check | Do not store raw key blobs; use native WebAuthn and the OS keychain; validate the rpId suffix | Security recipe passes; no plaintext keys on disk |
| ZEN-010 | Unauthenticated local agent server | Bind localhost, require a per-boot token, per-client consent | External process rejected |
| ZEN-011 | Automation reads leak URLs and form values; inputs are unbounded | Redact query, fragment, and credentials; cap page-text, wait, scroll, and coordinate inputs | Redaction and bounds unit tests |
| ZEN-012 | Assistant enabled by default raises the security posture | Ship the agent off by default; explicit enable with a clear explanation | Fresh profile has the agent off |
| ZEN-013 | Permission prompt integration | Use the OS-native prompt path; validate origins | Prompt test |
| ZEN-014 | Dependency and secret drift, no SBOM | Renovate with age gates; OSV and Grype scanning; Semgrep; gitleaks; a Syft SBOM per release | CI artifacts present per release |

## Stability and UX

| ID | Ticket | Recommended fix | Proof |
| --- | --- | --- | --- |
| ZEN-015 | Quit crashes with `SIGSEGV` (Mori #8) | Fix application teardown ordering; add crash telemetry | Quit 20 times cleanly |
| ZEN-016 | Cannot delete a Space (Reddit) | Implement delete with confirmation and tab reassignment | Interaction receipt |
| ZEN-017 | Empty tab folders are not persisted (Mori #1) | Persist folders regardless of contents | Relaunch retains an empty folder |
| ZEN-018 | Crash on launch when the Codex dependency is missing (Mori #2) | Make the agent optional; clear, actionable error state | Launch without the agent succeeds |
| ZEN-019 | Non-Views window defects: context menu, save-password crash, downloads TCC path, external links, hardcoded About (Millie PRs) | Fix each with regression tests | Per-item receipts |
| ZEN-020 | Build docs mixed legacy CEF and git-lfs confusion (Mori #5, PR #6) | Write a single accurate build guide for the landed source | Clean source builds on the Cloud host |
| ZEN-021 | Multi-profile per Space requested (Reddit) | Partition sessions and storage per profile; keep spaces within a profile | Two profiles isolated |
| ZEN-022 | Arc keyboard map and overflow controls requested | Implement the documented Arc shortcuts and the overflow menu | Shortcut test matrix |
| ZEN-023 | Windows and Linux requested (Reddit, Mori #7) | Defer; design the chrome cross-platform from day one | Backlog |

## Rejected

| Request | Reason |
| --- | --- |
| WebKit-based variant (Reddit) | Conflicts with the Chromium engine and the Chrome-extension goal |
| Full Chrome Web Store parity in v1 | Tracked as ZEN-001 and ZEN-002, not promised |
| Panel UI as a component source | React Native and Expo; not in the approved stack; dropped |
