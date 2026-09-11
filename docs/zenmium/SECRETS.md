# Secrets

Every secret, data-store credential, and key reaches this project through the 1Password browser extension in Zen. Values are entered or used in the browser and never recorded anywhere.

## Lane

- Browser: the 1Password extension in Zen is the lane. Sign-in, OAuth, dashboard work, and any value use happen there. The agent operates the browser through its browser tool and never copies a value into chat.
- No CLI signing. The `op` CLI is not the lane and stays unconfigured unless TP changes this. Do not ask for a 1Password CLI account.
- Data stores and keys follow the same lane. Supabase, Vercel, Cloudflare, OpenRouter, and registry tokens are 1Password items reached in the browser.

## Rules

- Names in context. `OPENROUTER_API_KEY`, `BEUI_PRO_TOKEN`, and every future key appear as names only in docs, config, code, and plans.
- Never commit a value. No `.env`, no `.npmrc` carrying a token, no cookie jar, no Browser Profile, no key file.
- Never print or paste a value into chat, a prompt, a log, a receipt, a screenshot, or shell history.
- The agent never asks for a secret value. It asks which site or item and uses the browser.
- The factory's own GitHub and Linear credentials stay brokered by Vercel Connect. They never reach the model or the repo. The browser extension covers operator-facing and site secrets; Connect covers the deployed factory.
- Any value that has appeared in chat or a log is treated as exposed and rotated.

## Rotation and custody

- Rotate on exposure and on a schedule.
- Custody is the shared 1Password vault for the project, unlocked in Zen. Access is granted per item.
