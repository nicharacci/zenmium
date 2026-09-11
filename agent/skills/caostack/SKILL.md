---
name: caostack
description: >-
  Goalpost factory engineering mode. Routes to pstack playbooks as CAOstack.
  Use for /caostack, /poteto-mode, CAOstack, or any rigorous implementation,
  bug, review, overnight, or ship task in Goalpost Code or this template.
---

# CAOstack

You are running **CAOstack**, the Goalpost Code load path. pstack is the engineering-task OS. This overlay is the factory station names, model panel, Computer, and stop-list.

## Load

1. If `vendor/pstack/skills/poteto-mode/SKILL.md` exists, follow it after this overlay.
2. If it does not, tell the operator to run `bash caostack/install.sh` and stop. Do not invent playbooks.
3. Never load `solvys-skills`, a 20 MB skill dump, or a Factory handbook into this session.

## Stations

| Station | Eve directory (kept for filesystem identity) | CAOstack name |
| --- | --- | --- |
| Root | `agent/` | CAO. Two hats: DevOps and BizOps. Does not write product code. |
| Intake | `classifier` | CAO intake. Clarifying questions, including on-demand Stack Interview. |
| Plan | `analyst` | Planner. Specs and acceptance. Grok 4.6 or DeepSeek v4 to freeze. |
| Build | `implementer` | `poteto-agent-1` (product slice) or `poteto-agent-2` (integration). Fan-out allowed. |
| Review | `reviewer` | Supervisor. Pushed branch only. Different model vendor than the implementer. Never Anthropic. |

`poteto-agent` is the base. 1 and 2 are variations.

## Always-on budget

AGENTS.md plus `.cursor/rules/caostack-core.mdc` only. Skills are a catalog. Full SKILL.md only when invoked.

## Models

No Anthropic, Claude, or Fable. Role defaults live in `caostack/lock.json`. Resolution order: OAuth providers with the model, then OpenCode Go, then Zen on the same key, then custom base URLs. Provider tiles appear only when connected and the model is available.

## Merge and stop-list

Inherit pstack. Unattended factory-label runs still open **draft** PRs (Eve trust). User-prompted ship uses pstack Shipping. Pause for unprompted force-push, data deletion, customer messages. User "deploy this" is authorization.

## Computer and login

Cloudflare Computer is the sandbox. Browser Profile mounts are owned by Goalpost Code (`docs` in that product). This template only passes `GPC_BROWSER_PROFILE_ID` into Computer. Do not store cookies in git or in the brain.

## Design

While building: shadcn-cssinjs registry `@shadcn-cssinjs`. Skill banks under `design/banks/`. Shadcndashboard is a paid build-kit pointer, not the stylist. Impeccable after the feature exists. Preview proof is a temporary Vercel link, not a ChatGPT Site.

## Clipboard

Workspace clips are Goalpost Code first-party on Computer. Clipth (MIT) is the local Mac extra. Not Paste.
