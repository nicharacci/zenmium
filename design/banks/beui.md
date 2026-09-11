# BeUI / BeUI Pro bank

Registry: shadcn-compatible. Free components live in the `@beui` namespace and install with `npx shadcn@latest add @beui/<name>` or directly from `https://beui.dev/r/<name>.json`. The private Pro registry lives at `https://pro.beui.dev/r/<name>.json` and requires `Authorization: Bearer ${BEUI_PRO_TOKEN}` in `components.json`.

License: BeUI is MIT (`github.com/starc007/ui-components`). BeUI Pro is paid and gated by a per-customer token.

When to load: Zenmium product chrome and interaction surfaces. Sidebar, tab strip, agent rail, chat app, prompt input, message list, tool approvals, drawers, and the command palette all draw from this bank. BeUI owns presentation only. Product state, routing, security, and the agent session stay product-owned.

Secrets: `BEUI_PRO_TOKEN` lives in 1Password and is resolved with `op`, or through the 1Password extension in Zen for browser work. Names in context, values never. Never commit the token, a resolved registry URL that carries it, or an `.npmrc` that contains it.

Relationship to other banks: for Zenmium this bank is primary for interaction and chrome, within the Solvys component hierarchy (BeUI Pro, then BeUI; Motionary.dev secondary; Bklit for data visualization). It replaces the generic `shadcn-cssinjs` alignment bank for product chrome work. Keep the registry and version current in this file as the source revision moves.
