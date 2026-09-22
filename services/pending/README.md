# services/pending/

T4 work that depends on T1's `browser/` tree, which is not on this checkout yet. Everything here is staged, reviewed, and ready to drop in once `browser/` exists; nothing here is dead work-in-progress.

## Contents

| File | What it is | Blocks on |
| --- | --- | --- |
| `services-endpoints.patch` | Repoints every services/updater/crash endpoint from imput/helium hosts to the Solvys Fly lane | `browser/patches/` existing; applies after the helium patch group |
| `SERIES.md` | The intended `patches/series` entry + ordering constraints | unification owns `series` |
| `platform-updater-urls.md` | Platform updater URL notes (mac Sparkle + win WinSparkle shapes, what sparkler emits vs what the browser expects) | T3 releases repo + `win/appcast.xml` producer |
| `import-path-note.md` | Text for the `docs/zenmium/S005-HELIUM-BASE.md` append section (file is T1-owned, absent here) | T1 |

## Applying when T1 lands

1. Move `services-endpoints.patch` to `browser/patches/zenmium/services-endpoints.patch`.
2. Add the series entry exactly as recorded in `SERIES.md` (through the unification merge, not by editing `series` from this track).
3. Run the endpoint sweep: `grep -rn "helium.imput.net\|imput.net\|helium.computer" browser/ platform/` must return zero unresolved hits for production endpoints.
4. Re-check hunk context if the upstream helium pin moved.

## Hostname caveat

All patch values use the Fly-assigned hostnames (`zenmium-services.fly.dev`, `zenmium-updates.fly.dev`, `zenmium-svc-crash.fly.dev`) so the stack works before the DNS decision lands. When the TP gate picks the real services hostname, update the patch values (one sed over this file) plus the `[env]` defaults in `deploy/fly/*/fly.toml`, then `fly certs add`.
