# Zenmium

Status: **planned**. No source exists yet. This repository-local planning set is the entry point.

## Original problem

TP currently tests Zen Browser as a daily driver. Zen runs on Gecko, so Chrome Web Store
extensions do not install and installable web apps such as wonder.so do not behave like apps.
The team also wants a browser primitive it can fold a first-class agent into, wrapped in the
approved BeUI component language, iterated fast, and hardened with community-trusted OSS
security primitives that patch quickly. No existing product satisfies all of that at once:
Arc is closed and frozen, Mori is a young experimental Chromium prototype, Zen is mature on the
wrong engine.

## Named solution

**Zenmium** — a standalone desktop browser built on a webshell + Chromium core, wrapped in
BeUI / BeUI Pro, with an embedded OpenCode agent rail that shares one Arc-style sidebar with the
browser, and a security layer built from trusted OSS primitives.

Outcome-owned objective: Deliver Zenmium so the operator can browse the real web with Chrome-class
extension and app-window behavior, drive an agent from the same sidebar, and receive Chromium
security updates on a dependency cadence. Ownership includes behavior, controls, design, security,
validation, and handoff.

## Decisions recorded

| ID | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | Shell | Electron (web chrome) + Chromium content; `BrowserCore` seam for a later native Chromium/CEF swap | Only shape that lets BeUI wrap the entire chrome, iterates in minutes, and updates Chromium by dependency |
| D2 | Agent kernel | OpenCode (`opencode serve` + `@opencode-ai/sdk`) | MIT, headless, typed SDK, provider-agnostic, BYO-agent via MCP/ACP/custom tools/plugins |
| D3 | Model gateway | OpenRouter; default `deepseek/deepseek-v4.1-flash` | One gateway, many models, DS v4.1 Flash is the default |
| D4 | UI libraries | BeUI (free, MIT) primary; BeUI Pro for gated blocks | Approved Solvys hierarchy; free BeUI includes the Chat App block |
| D5 | Repo shape | pnpm + Turborepo monorepo | One versioned workspace for shell, core, agent, ui, security, references |
| D6 | Build lane | GitHub-hosted ARM64 macOS runners | Electron builds are minutes; a Chromium fork would force MacStadium/EC2 Mac |
| D7 | Scope v1 | macOS first | Matches the operator's machine and the highest-fidelity proof surface |
| D8 | Panel UI | Dropped | React Native/Expo; not in the approved stack; cannot wrap a web product |

## Docs map

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system map, ownership, seams, extension model, security model, stack.
- [`PLAN.md`](PLAN.md) — S001 phased plan, acceptance checks, proof rungs, competitive rubric.
- [`ISSUES.md`](ISSUES.md) — ZEN ticket slate with recommended fixes and provenance.
- [`AGENT_ERGONOMICS.md`](AGENT_ERGONOMICS.md) — the addressable agent tower, Reference object, `@` tags, bookmarks, filetree.
- [`SECRETS.md`](SECRETS.md) — the 1Password secret lane and the names-only rule.

## Decisions locked

1. **Shell.** Electron v1 with the `BrowserCore` seam for a later native Chromium/CEF core.
2. **Repo home.** `nicharacci/zenmium`, instantiated from the Goalpost Factory Template.
3. **BeUI Pro.** Available; `BEUI_PRO_TOKEN` lives in 1Password, never in git.
4. **Agent kernel.** OpenCode in a monorepo; DeepSeek v4.1 Flash as a model via OpenRouter.
5. **Panel UI.** Dropped.

## Open authority items

1. **Repo role.** Is `nicharacci/zenmium` the factory workspace (targeting a separate product repo through `FACTORY_REPO`) or the product repo itself with the factory embedded?
2. **Product repo home.** Where the Zenmium browser source lives, and therefore the value of `FACTORY_REPO`.
3. **Design bank.** The factory's `design/banks` rule defaults to `shadcn-cssinjs` and warns against vendoring BeUI as the default. Adding BeUI means adding a bank file that names registry, license, and when to load it.
4. **Extension priority.** Confirm that a documented partial parity is acceptable for v1, or that full Chrome Web Store behavior is the gating requirement.

## Secret handling

The BeUI Pro token was supplied in chat and is treated as exposed. Rotate it and store the new value in 1Password under `BEUI_PRO_TOKEN`. Every secret, data-store credential, and key uses the same lane: `op` locally, or the 1Password extension in Zen for web sign-in. The only form this project records is the name. Full policy: [`SECRETS.md`](SECRETS.md).


## Provenance

- Electron extension API and limits: official Electron docs (`session.extensions.loadExtension`; extensions support matrix).
- OpenCode headless server, SDK, MCP, ACP, providers, license: `opencode.ai/docs`, MIT.
- BeUI: `github.com/starc007/ui-components` (MIT), `beui.dev`; BeUI Pro: `pro.beui.dev` (paid, private registry).
- GitHub-hosted macOS runner limits: GitHub Actions docs.
- Competitor facts: Mori repo docs and issues; Zen repo metadata; Arc help center and The Browser Company statements.
