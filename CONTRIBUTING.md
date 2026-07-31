# Contributing to encrypt.click

## Setup

- Node.js 18+
- pnpm 10

```bash
git clone https://github.com/danielsebesta/encrypt.git
cd encrypt
pnpm install
pnpm dev
```

Before opening a PR, run `pnpm build`.

Realtime (chat / whiteboard) needs PartyKit in another terminal: `pnpm partykit:dev`.

## Rules

- Do not hardcode user-facing English — put UI strings in `src/locales/*.json` (`en.json` is the source of truth; keep all 7 locales in sync).
- Keep crypto in `src/lib/crypto.ts` or `src/lib/ghost/`.
- Prefer existing UI patterns over new abstractions.
- Check affected pages across locales when changing public flows.

## Where things live (light map)

| Path | Purpose |
| --- | --- |
| `src/components/tools/` | Interactive tool UIs (+ `ToolHelp` for the `?` dialog) |
| `src/pages/tools/` | Tool page wrappers |
| `src/lib/tools.ts` | Tool registry / nav |
| `src/locales/` | Flat UI translations |
| `src/lib/ghost/` + `src/pages/api/ghost/` | Encrypted upload / decrypt |
| `party/` | PartyKit room servers (chat, whiteboard) |

## Adding a tool

1. Svelte component in `src/components/tools/`
2. Astro page in `src/pages/tools/` with `<ToolHelp client:load locale={locale} prefix="tools.myTool" />` next to the title
3. Registry entry in `src/lib/tools.ts` (`developer` or `privacy`)
4. Locale keys in all 7 files, including short help copy:
   - `tools.myTool.help.what`
   - `tools.myTool.help.safe`
   - optional `tools.myTool.help.watchOut`

## Pull requests

1. Branch → change → `pnpm build`
2. Spot-check affected locales
3. Open a PR with a short summary of user-visible changes
