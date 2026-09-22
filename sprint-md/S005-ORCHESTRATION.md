# S005 - Helium base

## Original Problem / Solution / Objective

- **Original Problem**: Zenmium is an Electron shell whose "Chromium" is Electron's pinned engine — capped extension parity, capped security cadence, and a browser that can never be a real browser.
- **Solution**: Zenmium on Helium — clone `imputnet/helium` + platform repos into this repo, rebrand to full Zenmium identity, port only the liquid-glass frame + sidebar + internal-products contract, self-host the services.
- **Objective**: Deliver Zenmium-on-Helium so the operator runs a Solvys-owned browser with Helium's privacy/security base and Zenmium's design + internal-product layer; TP owns final acceptance.

## Inventory verified 2026-09-22 (before handover)

- **Repo truth**: `nicharacci/zenmium`, branches `main` + `2026-09-12` (synced at `7cf7cf3`, PR #8 lane), tags `v0.0.1`/`v0.0.2`. Existing workflows `desktop.yml`, `macos-release.yml`, `windows-release.yml` — Electron lane, untouched.
- **Cabinet truth**: `Codebase Cabinet/zenmium/` (docs, cursor-receipts, private-ui, staging); `Project Records/zenmium/infraction-ledger.json` — INF-001 `asked-before-inventory` recurred during this planning session (count 6, recorded); north-star-status flags `factory-registry.yaml` predates zenmium — additive registry entry is a follow-up.
- **Upstream pins (live-verified)**: helium `0.17.2` (Chromium `153.0.8010.52`, rev 2), helium-macos `0.17.2.2`, helium-windows `0.17.2.2`, helium-services `7f3d42ebf00b`, cup2 `bee47000cd87`, helium-filters `95d0ac36162a`, helium-prism `e73a15554e29`, helium-onboarding `88e1b012b48f` (excluded). Platform `.gitmodules` `helium-chromium` → `imputnet/helium.git`.
- **Provider/CLI state**: `gh` → `nicharacci` ✓ (matches remote); `vercel` → `tp-solvys` ✓; `flyctl` installed but **unauthenticated** (human gate for T4); depot_tools/gn/ninja absent locally (expected — CI lane only).
- **Capacity**: internal disk **1.1 GB free** — all local implementation lanes closed; Ext recovery-only.
- **Linear**: not configured on this control plane (no Linear MCP); the repo's eve app uses a `linear/foreman-agent` Vercel Connect connector — unrelated to planning records. Cabinet + `PROJECT-STATE.md` govern.
- **Skills canon loaded**: solvys-cao, solvys-factory, solvys-orchestrate, solvys-building-blocks; design canon `docs/zenmium/DESIGN_SYSTEM.md` + `ZEN_SIDEBAR_SPEC.md`.

## Locked decisions (from discovery)

| Decision | Locked |
| --- | --- |
| Relationship to Helium | **Clone, not fork** — vendored trees, upstream SHA pinned in `PROVENANCE.md`, free to diverge |
| Repo home | Same repo `nicharacci/zenmium`, new tree (`browser/`, `platform/`, `services/`, `internal/`); `desktop/` frozen as legacy reference |
| Feature carry | Liquid-glass frame + sidebar + internal products + agent rail. **Greeting animation is dead** — neither Electron's `GoalpostOnboarding` nor `helium-onboarding` ships |
| Build lane | GitHub macOS large runner (+ Windows runner); local closed — **1.1 GB free measured 2026-09-22** |
| Services | Self-hosted from day one (`helium-services` + `cup2` + `helium-filters` on Fly.io as `zenmium-services`) |
| Platforms | macOS + Windows |
| Rebrand | Full Zenmium identity at clone time |
| Sprint / phase | S005, Pre-Release; date branch `2026-09-22`; checkpoint refs `refs/sprints/S005/T#/P#` |

## Track map

| Track | Title | Owns | Depends on | Checkpoint |
| --- | --- | --- | --- | --- |
| T1 | Helium clone & Zenmium identity | `browser/`, `platform/`, `.github/workflows/browser-*`, `docs/zenmium/S005-HELIUM-BASE.md` | — | `refs/sprints/S005/T1/P1` |
| T2 | Liquid-glass frame + sidebar | `browser/patches/zenmium/ui-*`, `browser/resources/zenmium/` | T1 | `refs/sprints/S005/T2/P1` |
| T3 | Internal-products contract + agent rail | `browser/patches/zenmium/internal-*`, `internal/`, `browser/resources/zenmium/internal/` | T1 (soft: T2 seam doc) | `refs/sprints/S005/T3/P1` |
| T4 | Self-hosted services | `services/`, `browser/patches/zenmium/services-endpoints.patch`, updater URLs | soft T1 (wiring patch only) | `refs/sprints/S005/T4/P1` |

## Shared-file rule

`browser/patches/series` is the only true shared file. Convention (created by T1): every Zenmium patch lives under `patches/zenmium/`; each track records its intended entries in `patches/zenmium/SERIES.md`; **unification owns the single `series` merge**. No track edits another track's patch files.

## Protected zones (sprint-wide)

- `desktop/**` — frozen Electron lane. Dirty tree belongs to the in-flight agent (`arc-core.ts`, `browser-native.ts`, `service-token.ts`, `workspace-sessions.ts`, `auth-compat.ts`, `onepassword-cli.ts`, `BrowserNativePanels.tsx`, `shared/browser-native.ts`, `verify-browser.mjs`, `verify-side-monitor.mjs`, `SECRETS.md`, two untracked test files). Read as reference; never modify/stage.
- `main` protected; `2026-09-12` belongs to PR #8's sprint — do not touch.
- `docs/zenmium/brand/zenmium-canonical.png` — sole canonical logo; derivatives only.
- Security laws carry to the new base: no raw global debugging endpoint, no plaintext pairing secrets, no credential values in observations/artifacts, no signature/native-messaging bypass.
- Fly app `goalpost` and all persist volumes — never touch.
- Secrets: names in context, values in Workspace Vault/Computer only.

## Assignment Matrix

| Issue | Brief | Owner | Execution path | Phase |
| --- | --- | --- | --- | --- |
| S005 - Helium base / ORCH | @sprint-md/S005-ORCHESTRATION.md | TP | planning/runbook/acceptance | Pre-Release |
| S005 - Helium base / T1 | @sprint-md/S005-T1-helium-clone-foundation.md | Codex Cloud | Cloud worktree + GitHub macOS/Windows large runners | Pre-Release |
| S005 - Helium base / T2 | @sprint-md/S005-T2-zenmium-chrome-ui.md | Codex Cloud | Cloud worktree + CI compile | Pre-Release |
| S005 - Helium base / T3 | @sprint-md/S005-T3-internal-products-contract.md | Codex Cloud | Cloud worktree + CI compile + paired smoke | Pre-Release |
| S005 - Helium base / T4 | @sprint-md/S005-T4-solvys-services.md | Codex Cloud | Cloud worktree + Fly.io deploy | Pre-Release |

Linear is not configured on this control plane (verified — no Linear MCP; the repo's eve app connector `linear/foreman-agent` is app code, not planning records). `PROJECT-STATE.md` + Cabinet records govern. Cycle/project/initiative: `not set in Linear API`.

## Human gates surfaced

1. **Fly auth** — `flyctl auth login` or `FLY_API_TOKEN` (Workspace Vault) required before T4's deploy half; vendoring + compose config work unblocked without it.
2. **Public services hostname** — Fly-assigned hostname works now; a `services.zenmium.*`/Solvys-domain DNS decision is TP's.
3. **Signing identities** — Apple Developer + Windows signing credentials when the release gate arrives (ad-hoc builds prove the pipeline first).
4. **CI spend** — macOS large-runner cold builds are multi-hour and billable; `paths:` filters + one-build-per-push-batch discipline.
5. **PR #8 merge** — the Electron sprint's merge decision stays with TP, independent of this rebase.
6. **Factory registry** — `factory-registry.yaml` lacks a zenmium entry (north-star flagged); add it additively at dispatch, not mid-flight.

## What died in the rebase (recorded, not silently dropped)

- Electron `desktop/` runtime: `arc-core.ts`, `extension-host.ts`, `store-install.ts`, Electron `safeStorage` token store, `WebContentsView` machinery, IPC layers.
- The wrapped Chrome Web Store install pipeline — Helium's native extension support + self-hosted proxy replaces it.
- The greeting/onboarding animation — deliberately not ported.
- Chrome Login Data/cookie/password extraction — boundary unchanged: 1Password extension + signed native connection is the credential lane.
- Widevine DRM — upstream limitation, documented.

## Unification

Dedicated unification pass owned by the orchestrator session (TP acceptance): merge `patches/series`, resolve any flag/endpoint collisions, run the full validation set (`git apply --check` on the complete series, both CI builds, paired-client smoke, endpoint sweep), then update `PROJECT-STATE.md` and write the S005 receipt to `docs/zenmium/`.

## Memory flush note

S005 planned 2026-09-22: Zenmium rebases from Electron-embedded Chromium to a cloned Helium base in the same repo; 4 tracks + unification; local disk measured 1.1 GB so all implementation is Cloud/CI; services self-hosted on Fly as `zenmium-services`; greeting animation killed; Electron lane frozen with dirty-tree custody preserved.
