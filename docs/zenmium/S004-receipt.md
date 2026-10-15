# S004 - Launchable ad-hoc macOS CI artifact receipt

## Outcome

The macOS local-test CI lane on branch `2026-09-12` produces launchable ad-hoc
artifacts on both push and pull_request events. The reported launch abort
(`Library not loaded: @rpath/Electron Framework.framework/Electron Framework`,
dyld `different Team IDs`) was reproduced on the real CI artifact, root-caused to
the ad-hoc identity combined with `hardenedRuntime: true`, and fixed in
`.github/workflows/macos-release.yml`. A verify-step guard now fails the run if a
local-test binary carries the runtime flag, since `codesign --verify` passes on
the broken combination.

## Proof gates

| Gate | Result |
| --- | --- |
| Original crash reproduced | Pass on downloaded run `35232560366` artifact |
| Fixed signature | `flags=0x2(adhoc)`, `TeamIdentifier=not set` on all nested binaries |
| `codesign --verify --deep --strict` | Pass on push-run and PR-run ZIP and DMG |
| Packaged launch | Pass on push-run ZIP, PR-run ZIP, and push-run DMG |
| Live UI verification | `verify-browser.mjs` 15/15 steps pass on the CI-built app launched under `ZENMIUM_VERIFY_SIDE_MONITOR=1` with an isolated profile on the DELL P2422H side monitor; one split-pane click case unavailable via CDP (native gesture only) |
| CI green on HEAD `f487c63` | `desktop` build, `macos` push, and `macos` pull_request all pass |
| `pnpm typecheck` / `pnpm test` | Clean; 158/158 unit tests pass |
| `pnpm test:native` | 36/36 attempted, 0 failures, 2 trusted-click cases unavailable without host focus |
| Secret scans | Source and artifact scans report 0 findings |

## Per-item proof

| # | Proof |
| ---: | --- |
| 1 | Ad-hoc identity is retained (`identity: "-"`, `identityValidation: false`, `CSC_IDENTITY_AUTO_DISCOVERY: "false"`); no certificate material exists in the lane. |
| 2 | `hardenedRuntime: false` is set in the CI packaging override, removing the `0x10002(adhoc,runtime)` flag combination that made dyld enforce same-team library validation. |
| 3 | The verify step greps `codesign -dv --verbose=4` output for `flags=.*runtime` and fails the run on a match. |
| 4 | `CSC_FOR_PULL_REQUEST: "true"` forces the ad-hoc signing step on `pull_request` events instead of shipping Electron's partial signature, which previously failed verification with "code has no resources". |
| 5 | `desktop.yml` and `windows-release.yml` pin pnpm `11.0.8`, matching the workspace layout with a `packages`-less `pnpm-workspace.yaml`. |
| 6 | The popup session-ownership and verification-startup suites from `1cbcc10` and `9b59360` pass in unit tests and were exercised live in the packaged artifact through CDP. |

## Protected-zone notes

- No secrets were committed; the lane uses ad-hoc signing only and no certificate
  material is exposed to pull_request builds.
- The user's Developer-ID-signed `/Applications/Zenmium.app` rollback was not
  replaced or modified.
- The in-flight agent's uncommitted working-tree changes were not included in any
  commit and remain unverified by this work.
- Signed/notarized release eligibility is unchanged and remains an open gate;
  this receipt covers ad-hoc local-test artifacts only.
