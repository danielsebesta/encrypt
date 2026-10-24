# Contributing to encrypt.click

## Setup

Node 24.21 (`.nvmrc`) and pnpm 10 through corepack.

```bash
git clone https://github.com/danielsebesta/encrypt.git
cd encrypt
pnpm install
pnpm dev
```

`pnpm dev` serves the site at `http://localhost:4321` without the chat and whiteboard rooms. `pnpm build && pnpm preview` runs the built Worker with the rooms. Calls need a TURN provider, so they only work on a deployed Worker with the secrets from the README.

Before opening a pull request run `pnpm test`, `pnpm check`, `pnpm build` and `pnpm audit`. CI runs the same four on every pull request and `main` requires that check to pass.

## Rules

- **No hardcoded user-facing text.** Every string goes to `src/locales/*.json`. `en.json` is the source of truth; add the key to all seven files in the same change.
- **Use the design system.** Tokens and component classes are in `src/styles/global.css`; copy an existing tool page for the layout. Do not add parallel styles or one-off components.
- **Keep crypto where it is.** `src/lib/passwordEnvelope.ts`, `src/lib/chatCrypto.ts`, `src/lib/ghost/` and `party/`. A UI change must not touch key handling, data formats or network behavior; if it has to, say so in the pull request.
- **Accessibility is part of done.** Every control has a label, icon-only buttons have `aria-label`, errors use `role="alert"`, results use `role="status"`, inputs are 16 px, and a page works at 320 px, with the keyboard, and in both themes.
- **Commits are yours.** Write them in your own name, one concern per commit, no tool or bot co-author trailers.

## Where things live

| Path | Purpose |
| --- | --- |
| `src/components/tools/` | Interactive tools, `ToolHelp.svelte` is the `?` dialog |
| `src/pages/tools/` | Tool pages, all on the same shell |
| `src/lib/tools.ts` | Tool registry for navigation and the home page |
| `src/locales/` | Flat UI dictionaries, seven languages |
| `src/lib/locale.ts` | Server-side language negotiation used by `src/worker.ts` |
| `src/lib/alias.ts` | Language-neutral participant aliases and colors |
| `src/styles/global.css` | Tokens and component classes |
| `src/lib/ghost/`, `src/pages/api/ghost/` | Encrypted upload, Send relay and fetch |
| `party/` | Chat and whiteboard rooms, PartyServer Durable Objects |
| `tests/` | Unit tests, run with `pnpm test` |

## Adding a tool

1. Create the Svelte component in `src/components/tools/` using only the classes from `src/styles/global.css`: input, options behind a disclosure, one primary button, status, result with copy or download.
2. Copy any file in `src/pages/tools/` and change the component import and the `tools.<name>` prefix.
3. Register the slug in `src/lib/tools.ts` under `privacy`.
4. Add to all seven locale files: `nav.tool.<name>`, `tools.<name>.h1` (same text as the navigation label), `.subtitle`, `.meta.title`, `.meta.description`, `.help.what`, `.help.safe` and optionally `.help.watchOut`.

## Pull requests

1. Branch from `main`, make the change, run the four commands above.
2. Check the affected pages in at least one non-English locale at 320 px and 1280 px, light and dark.
3. Open a pull request with a short summary of what a user will notice.

Merging to `main` deploys to production. Dependency updates come from Dependabot once a week; minor and patch updates merge on their own after the checks pass, majors wait for a review.
