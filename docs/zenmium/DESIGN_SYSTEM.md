# Zenmium design system (pre-canonical)

Status: pre-canonical. Adopted by TP approval. Source of truth for Zenmium's visual language until a canonical system is designated.

## Source of truth

- **Primary (code):** the Clypr prototype, `solvys-technologies/clypr`, `apps/prototype`. Local checkout: `/Users/tifos/Documents/Solvys/Internal Codebases/clypr/apps/prototype`. Deployed: `https://clypr-blond.vercel.app/`.
- **Visual reference (canvas):** the Wonder file `Clypr`, branch `main`, page `01a090d5-2725-757e-9d96-64ded9994c7f` (file `01a090d5-2723-7211-8915-c51a7a9d3bd6`). Exported via Wonder desktop "Copy as code" (`⌘⇧C`) under the sam@solvys.io profile.
- **Export assets:** `docs/zenmium/design/clypr-wonder/` (SVG nodes + `MANIFEST.json`). The raw 2 MB payload stays local at `~/Downloads/clypr-wonder/wonder-payload.json`.
- **Provenance rule:** the Wonder canvas is a reference; it is not runtime proof. The prototype code is the implementation authority.

## Stack

- Next.js 15, React 19, TypeScript.
- **Base UI** (`@base-ui/react`) primitives.
- **StyleX** (`@stylexjs/stylex`) styling.
- **shadcn-cssinjs** component source (`@shadcn-cssinjs`), MIT.
- **Phosphor** icons (`@phosphor-icons/react`), MIT. One icon family only.

## Tokens

- Colors are shadcn CSS variables in `oklch`, flat. The prototype palette is an explicit placeholder; TP owns palette and polish.
- `--radius: 0.625rem` (10px); button icon sizes use `min(radius, 12px | 10px)`.
- No gradients, glow, or blur.
- Font: Inter (normal), system UI fallback.
- Touch targets: minimum 44px for interactive controls.

## Components

`alert, badge, button, card, input, label, progress, separator, skeleton, switch, tabs, textarea`.

Button contract: variants `default | destructive | outline | secondary | ghost | link`; sizes `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`; `data-slot="button"`, `data-variant`, `data-size`; focus ring `0 0 0 3px color-mix(ring 50%, transparent)`; active `translateY(1px)`; transition `150ms cubic-bezier(0.4,0,0.2,1)`.

## Motion

- Every animation maps to a real state change; 120-320ms, easing that decelerates into rest.
- Reduced-motion renders state changes instantly.
- Never block the critical path.

## How this applies to Zenmium

- Zenmium is an Electron app, so the Clypr phone frame and mobile shell do not carry over; the **tokens, component anatomy, icon family, density, and motion rules do**.
- Port the Clypr tokens into `desktop/src/renderer/tailwind.css` as the shadcn variable set (already partially present).
- Adopt the Clypr component anatomy (Base UI behavior, StyleX-style state mapping translated to Tailwind classes) for the chrome.
- Swap the icon family to **Phosphor**.
- Keep the Zen sidebar geometry from `docs/zenmium/ZEN_SIDEBAR_SPEC.md`; the design system governs color, type, radius, density, and motion, not the Zen tab metrics.
- The browser chrome (sidebar, tab rows, URL pill, command palette, agent rail) is the surface this system restyles first.

## Ownership boundary

- TP owns palette, effects, and final polish.
- Agents assemble the component set and tokens; they do not invent a new visual identity.
