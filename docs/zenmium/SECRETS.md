# Secrets

Every secret, data-store credential, and key reaches this project through 1Password. Values are retrieved at the point of use and never recorded anywhere.

## Lane

- Local CLI: 1Password CLI (`op`, currently 2.39.0). Inject at runtime with `op run --env-file .env.1password` or `op read "op://<vault>/<item>/<field>"`, so the value exists only in the target process environment.
- Browser: the 1Password extension in Zen for web sign-in, OAuth, and dashboard work. Never type a credential into a page by hand and never copy one into chat.
- Data stores and keys follow the same lane. Supabase, Vercel, Cloudflare, OpenRouter, and registry tokens are 1Password items addressed by reference, never by value.

## Rules

- Names in context. `OPENROUTER_API_KEY`, `BEUI_PRO_TOKEN`, and every future key appear as names only in docs, config, code, and plans.
- Never commit a value. No `.env`, no `.npmrc` carrying a token, no cookie jar, no Browser Profile, no key file.
- Never print or paste a value into chat, a prompt, a log, a receipt, a screenshot, or shell history.
- The agent never asks for a secret value. It asks for the item name or vault reference and resolves it through `op`.
- The factory's own GitHub and Linear credentials stay brokered by Vercel Connect. They never reach the model or the repo. 1Password covers local and operator-facing secrets; Connect covers the deployed factory.
- Any value that has appeared in chat or a log is treated as exposed and rotated.

## Rotation and custody

- Rotate on exposure and on a schedule.
- Custody is the shared 1Password vault for the project. Access is granted per item by reference.
