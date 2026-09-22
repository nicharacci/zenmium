# services/deploy/fly

Fly.io lane for the vendored Solvys services (S005/T4). Sits next to upstream `deploy/` (Ansible, untouched for reference). Per-service Fly apps replace the single-host compose pod; the Fly edge terminates TLS so upstream's acme.sh sidecar is not used.

| Path | Purpose |
| --- | --- |
| `DEPLOY.md` | Step-by-step deploy: apps, secrets, order, health checks, DNS cutover |
| `env-manifest.md` | Every env var per app; secret vs env, required vs optional |
| `up.sh` | `fly deploy` sequence in dependency order (needs `fly auth`) |
| `edge/` | `zenmium-services` public nginx edge (fly-adapted conf + Dockerfile) |
| `ext-proxy/` | `zenmium-svc-ext` (internal) |
| `ubo/` | `zenmium-svc-ubo` (internal) |
| `minipush/` | `zenmium-svc-push` (public wss) |
| `minidumpster/` | `zenmium-svc-crash` (public, phase 2) |
| `symbolicator/` | `zenmium-svc-symbolicator` (internal, phase 2) |
| `updates/` | `zenmium-updates` (sparkler daemon + static appcast server) |
| `cup2/` | `zenmium-svc-cup2` (Zenmium-owned CUP-ECDSA signing edge) |

Everything here is Zenmium-owned glue: Dockerfiles and Deno entrypoints under `edge/`, `updates/`, and `cup2/` are new files; vendored upstream sources are never edited. See `../../PROVENANCE.md`.
