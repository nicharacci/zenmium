# S005 - Helium base

## Track T1 - Helium clone and Zenmium identity foundation

## Problem And Solution

- **Original Problem**: Zenmium on Electron cannot deliver real browser fidelity, extension parity, or a security update cadence; the Chromium it embeds is Electron's pinned engine and cannot be swapped.
- **Solution**: Zenmium on Helium — a direct clone (not a fork relationship) of `imputnet/helium` vendored into this repo, rebranded to full Zenmium identity and diverging freely.
- **Outcome Objective**: Deliver Zenmium-on-Helium so the operator runs a Zenmium browser whose base is Helium's degoogled Chromium; this track owner is responsible for behavior, controls, validation, and design proof of the clone, rebrand, and build pipeline.
- **Linear Review Source**: none (Linear not configured for this repo; Cabinet + `PROJECT-STATE.md` govern)

## Context

TP's directive (2026-09-22): rebuild everything Chromium-related to follow Helium (helium.computer) as the base. A **clone**, not a fork — our changes will dramatically alter the tree. Same repo, new tree: `nicharacci/zenmium` keeps the Electron app under `desktop/` (frozen, PR #8 lane) and the Helium clone lands beside it. Full Zenmium identity at clone time: names, bundle ids, icons, strings.

Upstream source layout and verified pins (queried live 2026-09-22 against `api.github.com`):

| Upstream repo | Pin | Notes |
| --- | --- | --- |
| `imputnet/helium` | tag `0.17.2` (2026-09-17), Chromium `153.0.8010.52`, helium revision `2` | ungoogled-chromium-style build config: `chromium_version.txt`, `revision.txt`, `deps.ini`, `downloads.ini`, `domain_regex.list`, `domain_substitution.list`, `flags.gn`, `patches/` (with `series`), `pruning.list`, `utils/`, `devutils/`, `i18n/`, `resources/` |
| `imputnet/helium-macos` | tag `0.17.2.2` (2026-09-22) | `build.sh`, `dev.sh`, `env.sh`, `flags.macos.gn`, `retrieve_and_unpack_resource.sh`, `sign_and_package_app.sh`, `patches/`, `resources/`, `docs/` |
| `imputnet/helium-windows` | tag `0.17.2.2` (2026-09-20) | `build.py`, `package.py`, `signing.py`, `flags.windows.gn`, `installer/`, `patches/`, `resources/` |

Submodule relationship (verified via `.gitmodules`): both platform repos carry `helium-chromium` pointing at `https://github.com/imputnet/helium.git` — i.e. the shared patchset nests inside the platform tree. Since we vendor all three flat, the platform `helium-chromium` path should reference the vendored `browser/` tree (or re-fetch at pin); record the chosen mechanism in each `PROVENANCE.md`.

Existing workflows in this repo — `desktop.yml`, `macos-release.yml`, `windows-release.yml` — belong to the Electron lane. New workflows MUST be new files (`browser-macos.yml`, `browser-windows.yml`) with `paths:` scoping, and must not rename or retrigger the existing ones.

The patchset repos are small (config + patches). The heavyweight part — depot_tools checkout of Chromium `153.0.8010.52` source, `gn gen`, `ninja` — happens only inside the CI build lane (see Execution Lane). depot_tools/gn/ninja are not installed locally; that is expected and correct.

## Solvys Coding-Agent Contract

- Follow `SOLVYS_AGENT_SYSTEM_PROMPT.md`.
- Start from repo truth and preserve intentional dirty state — the Electron lane under `desktop/` has an in-flight agent's uncommitted changes; do not touch, stage, or reformat any `desktop/` file.
- Prove completion through the highest-reality surface available: a CI-produced Zenmium artifact that launches.
- Keep visible UI canon stable; this track changes plumbing and identity, not the design language.

## Linear Scope

- **Issue naming**: `S005 - Helium base / T1 - Helium clone and identity`
- **Beta Phase**: Pre-Release
- **Linear Project**: not available — repo uses `PROJECT-STATE.md` + Cabinet records
- **Cycle**: not set in Linear API
- **Due date**: same-week Saturday (2026-09-26)
- **Assigned owner**: Codex Cloud (authoring) + GitHub CI (build proof)

## Branch Target

`2026-09-22`

`main` is protected and never a development lane. `2026-09-12` belongs to the Electron sprint and is off-limits.

## Cloud Pickup

- **Sprint identity**: `S005 - Helium base`
- **Accepted plan revision**: `sprint-md/S005-ORCHESTRATION.md` rev 1
- **Environment type**: repository-backed Codex Cloud for source authoring; GitHub-hosted runners for compile proof
- **Repository slug**: `nicharacci/zenmium`
- **Base commit**: HEAD of `2026-09-12` (`f487c63` or its descendant at dispatch — record actual)
- **Date integration branch**: `2026-09-22`
- **Task-owned checkpoint ref**: `refs/sprints/S005/T1/P1`
- **Checkout mode**: detached task-owned worktree
- **Protected zones**: `desktop/**` (frozen, dirty-tree ownership), `main`, `2026-09-12`, `docs/zenmium/brand/zenmium-canonical.png`, all secret values (names only)
- **Dependencies**: none — this track is the foundation
- **Secrets manifest (names only)**: none required for authoring; CI signing identities deferred to release gate
- **Proof gates**: `git apply --check` on all patches in `browser/patches/series`; CI workflow reaches a completed `ninja`/`autoninja` compile; produced artifact launches (`hdiutil attach` + `open` smoke on macOS runner)
- **Return path**: pushed branch + checkpoint ref + CI run URL to daily integrator
- **Closure condition**: Zenmium.app and Zenmium Windows zip artifacts exist from CI, or a recorded capacity/toolchain blocker with exact numbers

## User Testing Inheritance

- **Parent client objective**: operator installs and drives Zenmium-on-Helium instead of Zenmium-on-Electron
- **Inherited acceptance criterion**: CI artifact launches a real browser window rendering `helium`-base UI under Zenmium identity
- **Test-data boundary**: no real user profiles, no secrets, no Chrome profile data
- **Approval posture**: full for vendoring, rebrand edits, CI config
- **Genuine human-only gates**: Apple Developer / Windows signing credentials when the release gate arrives (not this track)
- **Acceptance branch**: `2026-09-22`

## Scope -- Included

- [ ] `browser/` — vendored clone of `imputnet/helium` at a pinned upstream commit, with `browser/PROVENANCE.md` recording upstream repo, commit SHA, date, and license (`LICENSE`, `LICENSE.ungoogled_chromium` preserved)
- [ ] `platform/macos/` — vendored clone of `imputnet/helium-macos`, same provenance treatment
- [ ] `platform/windows/` — vendored clone of `imputnet/helium-windows`, same provenance treatment
- [ ] `browser/patches/zenmium/` — namespace created; this track adds only the **identity/rebrand** patches
- [ ] `platform/*/patches/zenmium/` — platform identity patches (bundle id `com.zenmium.desktop`, app name, CFBundle display name, installer names)
- [ ] Full rebrand edits: product name strings, `chrome://` branding hooks Helium exposes, app icons regenerated from `docs/zenmium/brand/zenmium-canonical.png` into `platform/*/resources/` icon formats (icns, ico, png set)
- [ ] `flags.macos.gn` / `flags.windows.gn` reviewed and re-pointed at Zenmium endpoints (coordinate exact service hostnames with T4's delivered values — use `services.zenmium.internal` placeholders documented in the series README if T4 hasn't landed)
- [ ] `.github/workflows/browser-macos.yml` — `macos-15-xlarge` (or current large-runner label) build job: depot_tools bootstrap, `retrieve_and_unpack_resource.sh`, patch application (`git apply --check` first, then apply), `gn gen`, compile, `sign_and_package_app.sh` ad-hoc path, artifact upload
- [ ] `.github/workflows/browser-windows.yml` — `windows-latest` (or windows large runner) equivalent using `build.py`/`package.py`
- [ ] `docs/zenmium/S005-HELIUM-BASE.md` — the sprint contract: what was cloned, what changed at clone time, build instructions, upstream pin

## Scope -- Excluded (DO NOT TOUCH)

- `desktop/**` — Electron lane, frozen (PR #8, in-flight agent owns dirty tree)
- `services/**` — T4 owns
- Any sidebar, glass-frame, or feature patch — T2/T3 own; T1 ships identity patches only
- `patches/series` merge ordering for other tracks' patches — unification owns; T1 records a `browser/patches/zenmium/SERIES.md` convention (one file per domain, alphabetical within) so T2/T3/T4 drop files without touching the shared `series` until unification
- `agent/`, `evals/`, `workspaces/`, `caostack/` — eve factory surface, unrelated

## Frontend Gate

- Design impact: shell-level only at this stage — the rebrand swaps identity, not the Zenmium design language (T2 owns that). Recorded.
- Icon derivatives come from the canonical `zenmium-canonical.png`; they are format derivatives, not new design candidates (protected-zone rule).
- No ChatGPT Site — this is a native-app build track; proof is the launched artifact screenshot from CI, not a web preview.

## Execution And Storage Lane

- **Execution lane**: Codex Cloud worktree for authoring; **GitHub macOS large runner + Windows runner** for compile. Local lane is CLOSED — internal disk measured 1.1 GB free (2026-09-22), far below the ~100+ GB a Chromium checkout plus build outputs require and below the Factory 10 GB hard floor. Ext is recovery-only.
- **Workspace path or Cloud branch**: `2026-09-22`
- **Estimated peak storage**: Cloud worktree ~2 GB (vendored patchset trees only — Chromium source never enters the worktree); CI runner peak ~120–160 GB ephemeral
- **Capacity reservation**: CI minutes on large runners are billable — cap at one full build attempt per push batch; use `paths:` filters so `desktop/` changes never trigger browser builds
- **Exit condition**: artifact produced or capacity/toolchain blocker recorded with numbers
- **Closure state**: active

## Reuse Inventory (existing code to call, not reinvent)

- `docs/zenmium/brand/zenmium-canonical.png` — sole canonical logo; all icon generation derives from it
- `platform/macos/sign_and_package_app.sh` — Helium's own packaging; keep its structure, rebrand outputs
- Upstream `flags.gn` / `flags.macos.gn` — already carry degoogling; extend, don't rewrite
- `desktop/scripts/scan-secrets.mjs` — port its invocation into the browser CI as a pre-artifact secret scan step (do not modify the original)

## Known Issues to Preserve

- Electron lane dirty tree and PR #8 remain untouched; `desktop/` is reference material only.
- Helium's `helium-onboarding` component is intentionally **excluded/stubbed** by T2 — T1 must not wire it into the build if it's opt-in; if upstream builds it by default, T1 records the flag and T2 owns removal.

## Implementation Steps

1. Vendor `imputnet/helium` at tag `0.17.2` into `browser/`; write `browser/PROVENANCE.md` (upstream URL, tag, resolved commit SHA, date, license files).
2. Vendor `imputnet/helium-macos` at tag `0.17.2.2` into `platform/macos/` and `imputnet/helium-windows` at tag `0.17.2.2` into `platform/windows/`; each platform `.gitmodules` declares `helium-chromium` → `imputnet/helium.git` — point that path at the vendored `browser/` tree (or a pinned fetch) and record the mechanism in the platform `PROVENANCE.md`; the Chromium source itself is retrieved at build time, never committed.
3. Write `browser/patches/zenmium/SERIES.md` conventions + first identity patches (product name, bundle ids, version strings, about/credits strings).
4. Regenerate icon sets from `zenmium-canonical.png` into `platform/*/resources/`; update `sign_and_package_app.sh`/`package.py` product names to `Zenmium`.
5. Author `.github/workflows/browser-macos.yml` and `browser-windows.yml` with `paths:` scoping to `browser/**`, `platform/**`, and the workflow files.
6. Open CI build; iterate on `git apply --check` + GN/compile failures; land the checkpoint at `refs/sprints/S005/T1/P1` when artifacts exist or the blocker is quantified.

## Acceptance Criteria

- [ ] `browser/`, `platform/macos/`, `platform/windows/` vendored with provenance; repo builds the patch series cleanly (`git apply --check` green in CI).
- [ ] CI produces a `Zenmium`-branded macOS app (ad-hoc signed acceptable at this rung) and a Windows package, uploaded as workflow artifacts.
- [ ] The macOS artifact launches on the runner smoke step (open + first-window screenshot or `ps`/log assertion), proving the rebrand is live, not just renamed files.
- [ ] `desktop/` untouched; `git status` on the Electron lane identical before and after.
- [ ] `docs/zenmium/S005-HELIUM-BASE.md` exists and names the upstream pin.

## Validation Commands

```bash
# Patch series integrity (in CI and locally-safe)
cd browser && git apply --check --directory=src $(cat patches/series | grep -v '^#')

# macOS build (CI lane only)
cd platform/macos && ./build.sh

# Windows build (CI lane only)
cd platform/windows && python build.py && python package.py

# Secret scan on new tree
node desktop/scripts/scan-secrets.mjs browser platform || true
```

## Commit Format

```
S005 - Helium base / T1

Outcome: ...
Principal areas: browser/, platform/, .github/workflows/browser-*
Proof: CI run URL + artifact names
Protected zones: desktop/** untouched, main clean
Remaining blocker: ...
```
