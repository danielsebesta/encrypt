# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project overview

**encrypt.click** — *Your privacy is just a click away.* A privacy-first security toolkit built with Astro + Svelte. Most user-facing crypto runs in the browser, while a smaller set of server routes handle supporting flows such as Ghost Drop relays, URL shortening, and drand proxying.

## Commands

```bash
yarn install
yarn dev
yarn build
yarn preview
```

Validate changes with `yarn build`.

## Architecture

- **Astro 5** page shell
- **Svelte 5** interactive tools
- **Tailwind CSS v4**
- **Cloudflare adapter**
- **Astro i18n** with `en`, `cs`, `de`, `es`, `fr`, `sk`, `pl`

### Main systems

- `src/components/tools/*.svelte`
  Interactive tool UIs.

- `src/pages/tools/*.astro`
  Tool pages.

- `src/lib/tools.ts`
  Tool registry for navbar/category wiring.

- `src/locales/{en,cs,de,es,fr,sk,pl}.json`
  Flat UI translation dictionaries.

- `src/content/tool-education/*/*.json`
  Long-form educational content for the current 5-tool pilot.

- `src/lib/toolEducation.ts`
  Loader and runtime validation for education content.

- `generate-standalone.mjs`
  Standalone single-file HTML generator.

- `standalone-integration.mjs`
  Hooks standalone generation into `yarn build`.

- `src/lib/ghost/` and `src/pages/api/ghost/`
  Ghost Drop crypto, steganography, upload, fetch, and verification support.

### Important distinction

`src/lib/tools.ts` drives the site navigation and tool registry, but **standalone HTML exports are maintained separately** in `generate-standalone.mjs`.

If you add a tool and expect a downloadable standalone file, you must update both places.

## Current product shape

### Main site routes

- `/` homepage with `UltimateEncrypt`
- `/drop` Dead Drop
- `/u` decrypt / receive flow
- `/download` handoff download flow
- `/security` privacy and security summary
- `/tools/*` tool pages

### Tool categories in `src/lib/tools.ts`

- `developer`
- `cryptography`
- `privacy`

## Working rules

- Never hardcode user-facing English in components or pages.
- Put normal UI strings in `src/locales/*.json`.
- For the education pilot, keep long-form explanatory content in `src/content/tool-education/`.
- `en.json` is the source of truth for UI keys.
- Keep all non-English locale files in sync with English.
- Keep crypto logic in `src/lib/crypto.ts` or the existing `src/lib/ghost/` helpers.
- Do not add unnecessary comments.
- Prefer existing classes/components/patterns over parallel abstractions.

## Adding a new tool

Baseline checklist:

1. Create the Svelte tool component in `src/components/tools/`
2. Create the Astro page in `src/pages/tools/`
3. Register it in `src/lib/tools.ts`
4. Add locale keys to all 7 locale files

Optional follow-up depending on the tool:

5. Add a standalone export in `generate-standalone.mjs`
6. Add educational content in `src/content/tool-education/` per locale and wire it through `src/lib/toolEducation.ts`

## Education content pilot

The richer “Understand it” layer currently exists for:

- `base64`
- `bcrypt`
- `jwt`
- `time-capsule`
- `enigma`

Use those pages as the pattern if extending the system.

## Validation

- Run `yarn build`
- Check affected pages across all locales
- If you touched a standalone-capable tool, make sure the generated standalone HTML still works
