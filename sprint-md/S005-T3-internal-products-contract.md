# S005 - Helium base

## Track T3 - Internal-products contract and agent rail

## Problem And Solution

- **Original Problem**: Zenmium's reason to exist — the way it interacts with Solvys internal products — is welded to Electron IPC, `WebContentsView`, and `safeStorage`; none of those surfaces exist on a Chromium base.
- **Solution**: The Zenmium internal-products layer re-expressed on Chromium-native surfaces: guarded local control contract, native-messaging hosts, workspace profile mapping, and the agent rail as a browser-integrated dock driving the OpenCode kernel.
- **Outcome Objective**: Deliver the Zenmium internal-products contract so Solvys products (Goalpost first) can observe and drive the browser under explicit grants; this track owner is responsible for behavior, controls, validation, and security proof.
- **Linear Review Source**: none (Cabinet + `PROJECT-STATE.md` govern)

## Context

TP: "the only thing that needs to be different about Helium [is] the way it interacts with our internal products." The Electron implementation already solved the *contract* — this track ports the contract, not the Electron plumbing. The port source (frozen reference under `desktop/src/`):

| Electron source (frozen reference) | Lines | Port target on Helium base |
| --- | --- | --- |
| `shared/browser-control.ts` | 167 | Contract schema — reuse verbatim (zod, host-neutral v1: `pair`/`revoke`/`grants`/`createSession`/`execute`/`takeover`/`resume`/`events`, capabilities `observe`/`navigate`/`interact`/`tabs`/`downloads`/`authenticate`/`cdp`, grant TTL ≤8h) |
| `main/browser-control.ts`, `browser-control-bridge.ts`, `browser-control-native.ts`, `browser-control-client.ts` | 775 | Guarded local transport — authenticated local socket or native-messaging relay; **never a raw global debugging endpoint** (protected zone) |
| `main/native-messaging.ts` | 203 | Chromium native-messaging host manifests + host binary — Helium supports native messaging natively |
| `main/workspace-sessions.ts`, `profile-state.ts` | 155 | Workspace model → Chromium Profiles + Helium workspace/tab surfaces (map Spaces to profiles; record the mapping table) |
| `main/agent-kernel.ts`, `agent-chat-manager.ts` | 1165 | Agent rail: OpenCode kernel stays a local process; browser surface becomes a side-panel/WebUI dock (coordinate UI seam with T2) |
| `main/onepassword-cli.ts`, `service-token.ts` | ~200 | 1Password lane: the 1Password *extension* + its signed native-messaging path is the genuine boundary; token storage moves to OS keychain via the native host — no Electron `safeStorage` |
| `main/extension-host.ts`, `store-install.ts`, `extension-action-bridge.ts` | ~500 | **Mostly deleted**: Helium supports all Chromium extensions natively and proxies the Chrome Web Store through its services (T4 hosts that). Keep only Zenmium-private extension packaging if needed. |

## Solvys Coding-Agent Contract

- Follow `SOLVYS_AGENT_SYSTEM_PROMPT.md`.
- Start from repo truth; the frozen `desktop/` tree is reference documentation for the contract — read it, do not modify it.
- The trust model is structural: no raw global debugging endpoint, no plaintext pairing-secret persistence, no credential values in agent observations, no signature/native-messaging bypass. These protected-zone rules carry verbatim to the new base.
- Prove at the highest reality: a real paired client executing a granted `navigate` command against the built browser.

## Linear Scope

- **Issue naming**: `S005 - Helium base / T3 - Internal-products contract and agent rail`
- **Beta Phase**: Pre-Release
- **Linear Project**: not available
- **Due date**: 2026-09-26
- **Assigned owner**: Codex Cloud

## Branch Target

`2026-09-22` — after T1 checkpoint lands.

## Cloud Pickup

- **Sprint identity**: `S005 - Helium base`
- **Accepted plan revision**: `sprint-md/S005-ORCHESTRATION.md` rev 1
- **Environment type**: repository-backed Codex Cloud
- **Repository slug**: `nicharacci/zenmium`
- **Base commit**: T1 checkpoint `refs/sprints/S005/T1/P1`
- **Date integration branch**: `2026-09-22`
- **Task-owned checkpoint ref**: `refs/sprints/S005/T3/P1`
- **Checkout mode**: detached task-owned worktree
- **Protected zones**: `desktop/**`, series merge order, all secret values; pairing secrets persist only through the OS-secure store
- **Dependencies**: T1 (tree); soft coordination with T2 on the dock's UI seam (recorded interface, no file overlap)
- **Secrets manifest (names only)**: `OP_SERVICE_ACCOUNT_TOKEN` lane recorded per `docs/zenmium/SECRETS.md` policy; values never in repo or patches
- **Proof gates**: schema-level parity check (old vs new contract command set), `git apply --check` green, CI compile, paired-client smoke test in CI or recorded as runner-blocked
- **Return path**: branch + checkpoint ref + contract doc + smoke result
- **Closure condition**: contract landed and paired-command proof, or named blocker

## User Testing Inheritance

- **Parent client objective**: Solvys internal products drive Zenmium through the same contract they would have used on Electron
- **Inherited acceptance criteria**: contract command surface parity with `shared/browser-control.ts` v1; grant TTL enforced; pairing requires explicit user consent in-browser; agent rail streams a real OpenCode session
- **Test-data boundary**: no real vault items, no real profiles; fixture tokens only
- **Approval posture**: full for implementation; pairing consent flow is user-facing but testable with a synthetic actor
- **Acceptance branch**: `2026-09-22`

## Scope -- Included

- [ ] `browser/patches/zenmium/internal-*.patch` — Zenmium control surface: guarded local transport (loopback-only, pairing-required, per-grant capability check), profile/workspace mapping layer, first-run consent for pairing
- [ ] `browser/resources/zenmium/internal/` — Zenmium private component(s): agent-rail dock UI (WebUI or side-panel seam coordinated with T2), pairing/consent UI
- [ ] `internal/` (new top-level dir) — the native-messaging host + local control daemon source (Rust or Go — pick the lightest proven option; record choice and why), its installer manifest templates, and the OpenCode kernel bridge (spawn/monitor `opencode` process, stdio event pump)
- [ ] `internal/CONTROL-CONTRACT.md` — the ported v1 contract doc: commands, capabilities, grant lifecycle, event taxonomy, security boundaries, migration note from Electron IPC
- [ ] 1Password lane: extension policy (allowed/blocked extension rules per profile), native-messaging allowlist entries, documented Keychain storage path replacing `safeStorage`
- [ ] Workspace mapping table doc: Electron Space → Chromium Profile + Helium workspace mapping, including what does NOT port (Electron-specific session persistence semantics) — recorded, not silently dropped

## Scope -- Excluded (DO NOT TOUCH)

- `desktop/**` — reference only.
- Sidebar/frame patches — T2. The agent dock uses T2's documented side-panel/WebUI seam; T3 does not edit T2's patch files.
- `services/**` and endpoint flags — T4.
- `browser/patches/series` ordering — unification.
- The wrapped Chrome Web Store install pipeline — Helium's native extension support + T4's store proxy replace it; do not port `store-install.ts`.

## Frontend Gate

- The dock UI follows `docs/zenmium/DESIGN_SYSTEM.md` tokens and Phosphor icons; pairing/consent surfaces get enter/exit transitions per canon (120–320ms, decelerating, reduced-motion instant).
- No ChatGPT Site — native surface; proof is built-artifact screenshots + paired-command run.

## Execution And Storage Lane

- **Execution lane**: Codex Cloud authoring; CI compile; paired-client smoke on CI runner or recorded runner-blocked note. Local lane closed (1.1 GB free).
- **Workspace path or Cloud branch**: `2026-09-22`
- **Estimated peak storage**: worktree ~3 GB (adds `internal/` host source + toolchains); CI ~160 GB ephemeral
- **Exit condition**: contract + smoke proof or blocker
- **Closure state**: active

## Reuse Inventory (existing code to call, not reinvent)

- `shared/browser-control.ts` — the v1 schema is host-neutral by design; import semantics verbatim into `internal/CONTROL-CONTRACT.md`
- `main/browser-control.ts` grant lifecycle — port the state machine, not the IPC
- `docs/zenmium/SECRETS.md` — the operator-authorized 1Password CLI lane contract (2026-09-16) governs the token boundary
- `docs/zenmium/CHROME-EXTENSIONS.md`, `CHROME-IMPORT.md` — extension/import decisions already researched; Helium answers most of them natively
- Helium's extension support + anonymized Web Store proxy — replaces the Electron extension host

## Known Issues to Preserve

- "No raw global debugging endpoint" is a protected-zone law — the guarded transport must keep it true on the new base.
- `authenticate`/`cdp` capabilities exist in the v1 schema; keep them grant-gated, never ambient.
- The 1Password boundary stays: extension + signed native connection + vault approval; no secret extraction ever.

## Implementation Steps

1. Write `internal/CONTROL-CONTRACT.md` from `shared/browser-control.ts` + `main/browser-control*.ts` — full command/capability/event parity table.
2. Choose and record the transport + host language; scaffold `internal/` (native-messaging manifest, pairing flow, grant store behind OS keychain).
3. Author `browser/patches/zenmium/internal-*` wiring the browser side: profile→workspace mapping, consent UI, command dispatch to the host.
4. Port the agent rail: dock surface on T2's seam + kernel bridge to a local `opencode` process.
5. `git apply --check`, CI compile, paired-client smoke (`pair` → `createSession` → `navigate` on a fixture page).
6. Checkpoint `refs/sprints/S005/T3/P1`.

## Acceptance Criteria

- [ ] `CONTROL-CONTRACT.md` parity table shows every v1 command/capability mapped or explicitly deferred with reason.
- [ ] Pairing requires in-browser consent; grant TTL enforced; no ambient `cdp`.
- [ ] Agent rail opens a real OpenCode session and streams a response in the built browser (or runner-blocked recorded with exact cause).
- [ ] 1Password lane documented and policy-applied; no credential value in any artifact.
- [ ] `desktop/**` untouched.

## Validation Commands

```bash
cd browser && git apply --check --directory=src $(cat patches/series | grep -v '^#')
# Contract smoke (CI or dev shell where the built app exists):
#   internal/scripts/pair-smoke.sh <path-to-Zenmium-binary>
```

## Commit Format

```
S005 - Helium base / T3

Outcome: ...
Principal areas: browser/patches/zenmium/internal-*, internal/, browser/resources/zenmium/internal/
Proof: contract doc + smoke result
Protected zones: no raw debug endpoint, secrets boundary intact
Remaining blocker: ...
```
