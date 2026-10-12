# AGENTS.md
Guidance for coding agents working in this repository. `CLAUDE.md` is a symlink to this file.

## Project overview

**encrypt.click** - *Your privacy is just a click away.* A privacy-first security toolkit built with Astro + Svelte. Most user-facing crypto runs in the browser, while a smaller set of server routes handle supporting flows such as encrypted upload relays, URL shortening, drand proxying, realtime rooms and language negotiation.

## Commands

```bash
pnpm install
pnpm dev        # site without rooms
pnpm build
pnpm preview    # built Worker with rooms
pnpm test
pnpm check
```

Validate changes with `pnpm test`, `pnpm check` and `pnpm build`.

## Architecture

- **Astro 7** page shell
- **Svelte 5** interactive tools
- **Tailwind CSS v4** with the tokens and component classes in `src/styles/global.css`
- **Cloudflare Workers** with Durable Objects for rooms (PartyServer), entry in `src/worker.ts`
- **Astro i18n** with `en`, `cs`, `de`, `es`, `fr`, `sk`, `pl`; language chosen server-side in `src/lib/locale.ts`

### Main systems

- `src/components/tools/*.svelte` - interactive tool UIs (`ToolAbout.astro` = expandable "How it works" text below a tool)
- `src/pages/tools/*.astro` - tool pages, all on the same shell
- `src/lib/tools.ts` - tool registry for navbar, home page and category wiring
- `src/locales/{en,cs,de,es,fr,sk,pl}.json` - flat UI dictionaries
- `src/lib/alias.ts` - language-neutral participant aliases and colors for rooms
- `src/lib/ghost/` and `src/pages/api/ghost/` - encrypted upload crypto, stego, fetch, verification
- `party/` - chat and whiteboard room logic

## Current product shape

### Main site routes

- `/` homepage with the share form (`UltimateEncrypt`)
- `/share` the same share form on its own page
- `/u` decrypt / receive flow
- `/security` privacy and security summary (`/privacy` redirects here)
- `/chat` encrypted ephemeral chat
- `/whiteboard` collaborative whiteboard
- `/tools/*` tool pages

### Tool categories in `src/lib/tools.ts`

- `developer`
- `privacy`

## Working rules

- Use only the tokens and component classes in `src/styles/global.css`; do not add parallel abstractions. Copy an existing tool page for the layout.
- Never hardcode user-facing English in components or pages.
- Put normal UI strings in `src/locales/*.json`.
- Tool explainers live as numbered `tools.<name>.about.<n>` paragraphs with optional `tools.<name>.about.<n>.title` headings, shown via `ToolAbout`. Keep them accurate to the code.
- `en.json` is the source of truth for UI keys.
- Keep all non-English locale files in sync with English.
- Keep crypto logic in `src/lib/crypto.ts`, `src/lib/chatCrypto.ts`, `src/lib/ghost/` or `party/`; UI work must not change key handling, data formats or network behavior.
- Do not add unnecessary comments.
- Commit messages carry no co-author or tool attribution trailers.

## Adding a new tool

1. Create the Svelte tool component in `src/components/tools/`
2. Copy an existing page in `src/pages/tools/` and change the component import and the `tools.myTool` prefix
3. Register it in `src/lib/tools.ts`
4. Add locale keys to all 7 locale files: `nav.tool.myTool`, `tools.myTool.h1` (same text as the navigation label), `.subtitle`, `.meta.title`, `.meta.description`, `.about.1.title`, `.about.1` and further numbered sections

## Validation

- Run `pnpm test`, `pnpm check` and `pnpm build`
- Check affected pages across locales at 320 px and 1280 px, light and dark, with the keyboard
