# Development Contract: `launchable ad-hoc macOS CI artifact`

Contract ID: `S004`
Project: `zenmium`
Maturity: `micro`
Status: `verified`
Revision: `1`
Owner: `Devin (Devin Desktop session)`
Decision owner: `CAO`
Repository: `nicharacci/zenmium`
Base ref: `2026-09-12`
Base SHA: `453646d572d0ffcdd49fd17d66df0d13534698a4`
Dirty-state owner: `in-flight agent session; unrelated browser-native/auth-compat WIP, uncommitted and untouched`
Required proof rung: `installed`

## SPEC - Functional contract

### Objective

`Deliver a launchable ad-hoc-signed macOS CI artifact so testers and reviewers can run the exact build produced by pull_request and push pipelines.`

### Users and outcomes

- `developer` can `download the CI artifact, install it, and launch Zenmium without a dyld abort`.
- `reviewer` can `trust that a green macOS workflow means the packaged app actually launches`.

### In scope

- `.github/workflows/macos-release.yml` signing configuration for the local-test lane.
- `.github/workflows/desktop.yml` and `.github/workflows/windows-release.yml` pnpm version pins.
- The signature verify step guarding the ad-hoc/hardened-runtime invariant.

### Out of scope

- The Developer ID signed release lane (`pnpm package` with real identity) and notarization.
- Product code under `desktop/src/`.

### Assumptions

- No certificate material exists in CI; ad-hoc signing is the only identity available there, so `CSC_FOR_PULL_REQUEST` leaks nothing.

### Functional requirements

- `FR-1: The macOS workflow produces an app bundle whose every Mach-O signature is ad-hoc without the hardened runtime flag, so dyld's same-team library validation does not abort launch.`
- `FR-2: The bundle is signed identically on pull_request and push events.`
- `FR-3: The verify step fails the run if a local-test binary carries the hardened runtime flag.`

### Acceptance scenarios

#### AC-1 - `CI artifact launches`

Given `a macOS workflow run produced Zenmium.app`
When `the app binary is executed on an arm64 Mac`
Then `the process starts instead of aborting in dyld with a Team ID mismatch`

#### AC-2 - `verify step guards the invariant`

Given `an ad-hoc-signed bundle`
When `codesign -dv reports the runtime flag on the main executable`
Then `the verify step exits nonzero`

### Edge and failure cases

- `If a real signing identity is later added to CI, the hardenedRuntime:false override must be revisited; the guard message names the invariant so the failure is self-explanatory.`

### Open questions

`None`

## PLAN - Technical contract

### Current source and accepted patterns

- Repository truth: `nicharacci/zenmium @ 2026-09-12, base 453646d; dirty files owned by the in-flight agent session`
- Existing pattern: `custom mac.sign callback invoking @electron/osx-sign signAsync`
- External source: `electron-builder pull_request signing skip behavior, documented in electron-builder logs and source`

### Architecture and contracts

- `hardenedRuntime: false` in the workflow's mac config override drops the runtime flag for the ad-hoc lane only; package.json keeps hardenedRuntime:true for the Developer ID lane.
- `CSC_FOR_PULL_REQUEST: "true"` re-enables the custom ad-hoc sign path on pull_request events.
- `desktop.yml` and `windows-release.yml` pin pnpm 11.0.8 to match the repo's pnpm-workspace.yaml format.

### Exact commands

- Focused test: `codesign -dv --verbose=4 dist/mac-arm64/Zenmium.app/Contents/MacOS/Zenmium | grep -q runtime` must produce no match
- Full validation: `codesign --verify --deep --strict dist/mac-arm64/Zenmium.app`
- Build: `electron-builder via the workflow's node script (identity "-")`
- Runtime or Site: `dist/mac-arm64/Zenmium.app/Contents/MacOS/Zenmium --no-sandbox --user-data-dir=/tmp/zn-verify` stays running

### Testing and proof

- `Artifact launch test on the CI-produced ZIP and DMG; required proof rung: installed`

### Security, performance, and observability

- `Not applicable beyond signing integrity; ad-hoc artifacts carry no credentials and are local-test only`

### Boundaries

- Always: `verify the produced bundle's signature flags, not just codesign --verify`
- Ask first: `before adding a real signing identity or notarization to CI`
- Never: `re-enable hardened runtime on an ad-hoc-signed build`

### Risks and rollback

- Risk: `a future identity addition conflicts with hardenedRuntime:false in the workflow override`
- Rollback: `revert 929bd0b and dc2850d; both are isolated workflow commits`

## TASKS - Ordered execution

### T1 - `drop hardened runtime from ad-hoc packaging`

- Size: `S`
- Owner: `Devin`
- Dependencies: `None`
- Files: `.github/workflows/macos-release.yml`
- Acceptance: `AC-1, AC-2`
- Verify: `package locally with the workflow's script, confirm flags=0x2(adhoc) and the app launches`
- Checkpoint: `commit 929bd0b`

### T2 - `sign ad-hoc on PR runs and pin pnpm 11`

- Size: `S`
- Owner: `Devin`
- Dependencies: `T1`
- Files: `.github/workflows/macos-release.yml`, `.github/workflows/desktop.yml`, `.github/workflows/windows-release.yml`
- Acceptance: `AC-1`
- Verify: `PR #8 pull_request runs green: build 35279035937, macos 35279035882`
- Checkpoint: `commit dc2850d`

## Change log

- Revision 1: `written retroactively after implementation; work verified on CI runs 35277747175 and 35279035882, artifacts launch-tested locally`
