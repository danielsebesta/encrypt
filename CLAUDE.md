# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**encrypt.click** — a privacy-first, client-side security toolkit. All crypto runs 100% in-browser via Web Crypto API. No servers, no logs, no tracking. Deployed on Cloudflare Pages.

## Commands

```bash
yarn install        # install dependencies (Yarn 4 / Berry)
yarn dev            # dev server at http://localhost:4321
yarn build          # production build (outputs to dist/)
yarn preview        # preview production build locally
```

No test runner or linter is configured. Validate changes with `yarn build`.

## Architecture

**Stack:** Astro (static output) + Svelte 5 (interactive components) + Tailwind CSS v4. Cloudflare Pages adapter.

### Key patterns

- **Tool = 3 parts:** Svelte component (`src/components/tools/*.svelte`) + Astro page (`src/pages/tools/*.astro`) + registry entry (`src/lib/tools.ts`)
- **All crypto logic** lives in `src/lib/crypto.ts` — tool components import functions from here
- **i18n:** Flat JSON dictionaries in `src/locales/{en,cs,de}.json`. All user-facing strings use `t(dict, 'key')` — never hardcode English. `en.json` is source of truth; `t()` falls back to English for missing keys.
- **Standalone builds:** `generate-standalone.mjs` produces self-contained single-file HTML versions of each tool (inlined CSS/JS, trilingual). Runs automatically during `yarn build` via the `standalone-integration.mjs` Astro integration.
- **Security headers** applied via `src/middleware.ts` (strict CSP, HSTS, X-Frame-Options, etc.). Dev mode relaxes CSP for HMR websockets.
- **Ghost subsystem** (`src/lib/ghost/`) — steganography + crypto for anonymous upload feature, with API routes in `src/pages/api/ghost/`.
- **API routes** under `src/pages/api/` handle server-side features: tunnel endpoints, URL shortener, drand proxy, ghost upload/fetch.

### Registries

Two registries drive the app:

1. **`src/lib/tools.ts`** — tool definitions (slug, i18n prefix, category). Adding an entry here auto-populates the navbar.
2. **`src/lib/languages.ts`** — language definitions. Adding a language here auto-populates the language picker.

### Adding a new tool (4-step checklist)

1. Create Svelte component: `src/components/tools/MyTool.svelte` (accept `locale` prop, derive `dict` reactively)
2. Create Astro page: `src/pages/tools/my-tool.astro` (use `Layout`, hydrate with `client:load`)
3. Register in `src/lib/tools.ts`: `{ slug: 'my-tool', i18nPrefix: 'tools.myTool', navLabelKey: 'nav.tool.myTool', category: 'developer' }`
4. Add translation keys to **all** locale files (`src/locales/*.json`)

### Adding a new language

1. Add to `src/lib/languages.ts`
2. Create `src/locales/{code}.json` (copy `en.json`, translate)
3. Import and register in `src/lib/i18n.ts`
4. Add to `astro.config.mjs` `i18n.locales` and `i18n.fallback`

## Code Conventions

- No unnecessary comments — don't narrate what the code does
- Prefer Tailwind utility classes; use existing CSS classes: `input`, `btn-primary`, `card`
- TypeScript for props, function signatures, and exports
- No external network calls from crypto operations — everything client-side
- Tool categories: `developer`, `cryptography`, `privacy`
- Tool slug must match the `.astro` filename in `src/pages/tools/`
