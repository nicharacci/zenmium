# Goalpost Factory Template

GitHub template for company workspaces in **Goalpost Code**. This is the base. Live Solvys cabinets live in `solvys-technologies/solvys-factory`, not here.

The root agent is **CAO** (DevOps and BizOps hats). Implementation is **CAOstack**: pstack playbooks under `poteto-agent-1` / `poteto-agent-2`, reviewed by a **supervisor** who sees the pushed branch only. Eve keeps the filesystem, trust stamps, and draft-PR unattended path. Cloudflare Computer is the target sandbox. Vercel Sandbox remains the eve backend until the Computer adapter lands.

## What this is not

- Not a copy of `solvys-skills` or Codebase Cabinet.
- Not Bitwarden, Paste, ChatGPT Site, or Anthropic.
- Not the Goalpost BizOps Fly app.

## Stations

| Eve directory | Role |
| --- | --- |
| root | CAO. Routes. Does not write product code. |
| classifier | CAO intake. On-demand Stack Interview when a missing product call would waste a run. |
| analyst | Planner. |
| implementer | poteto-agent-1 or poteto-agent-2. CAOstack / pstack. |
| reviewer | Supervisor. Independent vendor. Never Anthropic. |

## Install

```bash
bash caostack/install.sh    # vendor pstack. No solvys-skills.
pnpm install                # Node 24.x
pnpm validate
```

`caostack/lock.json` pins pstack, ponytail, shadcn-cssinjs, clipth, impeccable, and cursor-team-kit. Paid Shadcndashboard stays a pointer, not a zip in git.

## How work arrives

Same as the eve factory line: label `factory`, @mention, Linear Agent Sessions, local `pnpm dev`, red CI on factory branches. Unattended runs still open **draft** PRs. User-prompted ship follows pstack Shipping.

## Workspace graph

See `workspaces/`. DevOps teams sit above BizOps teams and may manage linked BizOps workspaces. Hats are how CAO switches in one chat.

## Design banks

See `design/banks/`. Default while building is shadcn-cssinjs. Preview proof is a temporary Vercel link.

## Browser login

Goalpost Code owns Browser Profiles (Chromium user-data dir, Credential Roundup, 2FA in the profile window). This template only accepts `GPC_BROWSER_PROFILE_ID` for Computer mounts.

## Models

No Anthropic. Defaults in `agent/lib/models.ts` and `caostack/lock.json`. Resolution: OAuth, then OpenCode Go, then Zen on the same key, then custom base URLs.

## Resources

- [eve documentation](https://eve.dev/docs/introduction)
- [pstack](https://github.com/cursor/plugins/tree/main/pstack)
- [shadcn-cssinjs](https://github.com/shadcn-labs/shadcn-cssinjs)
