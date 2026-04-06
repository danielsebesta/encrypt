# Contributing to encrypt.click

This repo is small, but it has a few systems that need to stay in sync: Astro pages, Svelte tool UIs, translations, and the education-content pilot.

## Prerequisites

- Node.js 18+
- Yarn 4

## Setup

```bash
git clone https://github.com/danielsebesta/encrypt.click.git
cd encrypt.click
yarn install
yarn dev
```

Dev server: `http://localhost:4321`

Before opening a PR, run:

```bash
yarn build
```

## Core rules

- Do not hardcode user-facing English in components or pages.
- Put normal UI strings in `src/locales/*.json`.
- Keep crypto logic in `src/lib/crypto.ts` or the existing ghost helpers under `src/lib/ghost/`.
- Prefer existing UI patterns and shared classes over inventing parallel systems.
- If you change a public-facing flow, check all locales (`en`, `cs`, `de`, `es`, `fr`, `sk`, `pl`).

## Important directories

| Path | Purpose |
| --- | --- |
| `src/components/tools/` | Interactive Svelte tool UIs |
| `src/pages/tools/` | Astro wrappers for tool pages |
| `src/lib/tools.ts` | Tool registry for navbar/category wiring |
| `src/locales/*.json` | Flat UI dictionaries |
| `src/content/tool-education/` | Long-form education content for the pilot tools |
| `src/lib/toolEducation.ts` | Education content loader and types |

## Adding a new tool

Most new tools need these pieces:

1. Create `src/components/tools/MyTool.svelte`
2. Create `src/pages/tools/my-tool.astro`
3. Add the tool to `src/lib/tools.ts`
4. Add locale keys to all 7 locale files

### Component example

```svelte
<script lang="ts">
  import { getTranslations, t, type Locale } from '../../lib/i18n';

  export let locale: Locale = 'en';
  let input = '';
  let output = '';

  $: dict = getTranslations(locale);

  function run() {
    output = input.toUpperCase();
  }
</script>

<div class="space-y-6 text-left">
  <div>
    <label class="label block">{t(dict, 'tools.myTool.inputLabel')}</label>
    <textarea bind:value={input} class="input h-28 w-full" />
  </div>

  <button type="button" class="btn w-full" on:click={run}>
    {t(dict, 'tools.myTool.runButton')}
  </button>

  {#if output}
    <div>
      <label class="label block">{t(dict, 'tools.myTool.outputLabel')}</label>
      <textarea readonly value={output} class="input h-28 w-full" />
    </div>
  {/if}
</div>
```

### Page example

```astro
---
import Layout from '../../layouts/Layout.astro';
import MyToolView from '../../components/tools/MyTool.svelte';
import { getTranslations, t, type Locale } from '../../lib/i18n';

const locale = (Astro.currentLocale ?? 'en') as Locale;
const dict = getTranslations(locale);
---

<Layout
  title={t(dict, 'tools.myTool.meta.title')}
  description={t(dict, 'tools.myTool.meta.description')}
>
  <div class="max-w-6xl mx-auto px-5 py-12 md:py-20">
    <div class="tool-hero">
      <div class="tool-hero__copy">
        <h1 class="tool-hero__title">
          {t(dict, 'tools.myTool.h1')}
          <span class="text-emerald-500">{t(dict, 'tools.myTool.h1Highlight')}</span>
        </h1>
        <p class="tool-hero__subtitle">{t(dict, 'tools.myTool.subtitle')}</p>
      </div>
    </div>

    <div class="card p-8">
      <MyToolView client:load locale={locale} />
    </div>
  </div>
</Layout>
```

### Tool registry

Add one entry to `src/lib/tools.ts`:

```ts
{ slug: 'my-tool', i18nPrefix: 'tools.myTool', navLabelKey: 'nav.tool.myTool', category: 'developer' }
```

Categories:
- `developer`
- `privacy`

### Locale keys

Add keys to all 7 locale files under `src/locales/`.

Example:

```json
"nav.tool.myTool": "My Tool",
"tools.myTool.meta.title": "My Tool — encrypt.click",
"tools.myTool.meta.description": "Short SEO description.",
"tools.myTool.h1": "My",
"tools.myTool.h1Highlight": "Tool.",
"tools.myTool.subtitle": "One-line description.",
"tools.myTool.inputLabel": "Input",
"tools.myTool.runButton": "Run",
"tools.myTool.outputLabel": "Output"
```

## If the tool should use the education layer

The current pilot tools are:

- `base64`
- `bcrypt`
- `jwt`
- `time-capsule`

To extend that system:

1. Add locale-specific content files in `src/content/tool-education/`
2. Match the schema in `src/content.config.ts`
3. Extend the slug union in `src/lib/toolEducation.ts`
4. Render `ToolQuickFacts` and `ToolEducationPanel` on the page

Use the existing pilot pages as the reference implementation.

## Translations

- `en.json` is the source of truth for UI strings.
- `t()` falls back to English, but do not rely on that in finished work.
- Keep the locale files in sync.
- Long educational copy belongs in `src/content/tool-education/`, not in the flat locale dictionaries.

## Common edit targets

- Homepage sections: `src/components/home/`
- Tool pages: `src/pages/tools/`
- Tool components: `src/components/tools/`
- Navigation / language UI: `src/layouts/Layout.astro`
- Shared styles: `src/styles/global.css`
- Security/privacy page: `src/pages/security.astro`
- Dead Drop: `src/pages/drop.astro`
- Receive/download flow: `src/pages/u.astro`, `src/pages/download.astro`

## Pull requests

1. Create a branch.
2. Make the change.
3. Run `yarn build`.
4. Check the affected page in all relevant locales.
5. Open the PR with a clear summary of user-visible changes.
