# CLAUDE.md
This file provides guidance to Claude Code when working in this repository.

## Project overview

**encrypt.click** - *Your privacy is just a click away.* A privacy-first security toolkit built with Astro + Svelte. Most user-facing crypto runs in the browser, while a smaller set of server routes handle supporting flows such as encrypted upload relays, URL shortening, and drand proxying.

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
```

Validate changes with `pnpm build`.

## Architecture

- **Astro 5** page shell
- **Svelte 5** interactive tools
- **Tailwind CSS v4**
- **Cloudflare adapter**
- **Astro i18n** with `en`, `cs`, `de`, `es`, `fr`, `sk`, `pl`

### Main systems

- `src/components/tools/*.svelte` — interactive tool UIs (`ToolHelp.svelte` = `?` dialog)
- `src/pages/tools/*.astro` — tool pages
- `src/lib/tools.ts` — tool registry for navbar/category wiring
- `src/locales/{en,cs,de,es,fr,sk,pl}.json` — flat UI dictionaries
- `src/lib/ghost/` and `src/pages/api/ghost/` — encrypted upload crypto, stego, fetch, verification

## Current product shape

### Main site routes

- `/` homepage with `UltimateEncrypt`
- `/u` decrypt / receive flow
- `/security` privacy and security summary (`/privacy` redirects here)
- `/chat` encrypted ephemeral chat
- `/whiteboard` collaborative whiteboard
- `/tools/*` tool pages

### Tool categories in `src/lib/tools.ts`

- `developer`
- `privacy`

## Working rules

- Never hardcode user-facing English in components or pages.
- Put normal UI strings in `src/locales/*.json`.
- Tool explainers live as short `tools.<name>.help.*` locale keys, shown via `ToolHelp`.
- `en.json` is the source of truth for UI keys.
- Keep all non-English locale files in sync with English.
- Keep crypto logic in `src/lib/crypto.ts` or the existing `src/lib/ghost/` helpers.
- Do not add unnecessary comments.
- Prefer existing classes/components/patterns over parallel abstractions.

## Adding a new tool

1. Create the Svelte tool component in `src/components/tools/`
2. Create the Astro page in `src/pages/tools/` (include `<ToolHelp … prefix="tools.myTool" />`)
3. Register it in `src/lib/tools.ts`
4. Add locale keys to all 7 locale files, including `tools.myTool.help.what`, `.safe`, and optional `.watchOut`

## Validation

- Run `pnpm build`
- Check affected pages across all locales
