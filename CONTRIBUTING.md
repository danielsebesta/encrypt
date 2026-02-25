# Contributing to encrypt.click

Thanks for your interest in contributing! This guide walks you through the process.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Yarn](https://yarnpkg.com/) (classic or berry)

## Setup

```bash
git clone https://github.com/danielsebesta/encrypt.click.git
cd encrypt.click
yarn install
yarn dev
```

The dev server starts at `http://localhost:4321`.

## Adding a New Tool

This is the most common contribution. The system is modular — you only touch 4 files and 2 registries.

### Step 1 — Create the Svelte component

Create `src/components/tools/MyTool.svelte`:

```svelte
<script lang="ts">
  import { getTranslations, t } from '../../lib/i18n';
  export let locale = 'en';
  $: dict = getTranslations(locale);

  let input = '';
  let output = '';

  function run() {
    output = input.toUpperCase(); // your logic here
  }
</script>

<div class="space-y-6 text-left">
  <div>
    <label class="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
      {t(dict, 'tools.myTool.inputLabel')}
    </label>
    <textarea
      bind:value={input}
      placeholder={t(dict, 'tools.myTool.inputPlaceholder')}
      class="input w-full h-28 font-mono text-sm"
    />
  </div>

  <button on:click={run} class="btn-primary w-full">
    {t(dict, 'tools.myTool.runBtn')}
  </button>

  {#if output}
    <div>
      <label class="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
        {t(dict, 'tools.myTool.outputLabel')}
      </label>
      <textarea readonly value={output} class="input w-full h-28 font-mono text-sm" />
    </div>
  {/if}
</div>
```

Key rules:
- Every user-visible string uses `t(dict, 'key')`. No hardcoded English.
- Accept `locale` as a prop. Derive `dict` reactively.
- Use existing CSS classes: `input`, `btn-primary`, `card`.

### Step 2 — Create the Astro page

Create `src/pages/tools/my-tool.astro`:

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
  <div class="max-w-2xl mx-auto px-5 py-12 md:py-20 text-center">
    <div class="mb-12">
      <h1 class="text-3xl md:text-4xl font-bold tracking-tight mb-4">
        {t(dict, 'tools.myTool.h1')}
        <span class="text-emerald-500">{t(dict, 'tools.myTool.h1Highlight')}</span>
      </h1>
      <p class="text-zinc-500 dark:text-zinc-400 text-sm md:text-base">
        {t(dict, 'tools.myTool.subtitle')}
      </p>
    </div>
    <div class="card p-8">
      <MyToolView client:load locale={locale} />
    </div>
  </div>
</Layout>
```

The `client:load` directive hydrates the Svelte component on the client side.

### Step 3 — Register the tool

Open `src/lib/tools.ts` and add one line to the `tools` array:

```ts
{ slug: 'my-tool', i18nPrefix: 'tools.myTool', navLabelKey: 'nav.tool.myTool', category: 'developer' },
```

- `slug` must match the filename in `src/pages/tools/` (without `.astro`).
- `category` is one of: `developer`, `cryptography`, `privacy`.
- The tool auto-appears in the correct navbar category.

### Step 4 — Add translations

Add keys to **every** locale file (`src/locales/en.json`, `src/locales/cs.json`, etc.):

```json
"nav.tool.myTool": "My Tool",
"tools.myTool.meta.title": "My Tool — encrypt.click",
"tools.myTool.meta.description": "Short SEO description.",
"tools.myTool.h1": "My",
"tools.myTool.h1Highlight": "Tool.",
"tools.myTool.subtitle": "One-liner about this tool.",
"tools.myTool.inputLabel": "Input",
"tools.myTool.inputPlaceholder": "Enter text...",
"tools.myTool.runBtn": "Run",
"tools.myTool.outputLabel": "Output"
```

If you can't translate to Czech (or other languages), add the English values — maintainers will translate later.

### Done

Run `yarn dev` and navigate to `/tools/my-tool`. The tool appears in the navbar and works in all languages.

---

## Adding a New Language

1. Add the locale to `src/lib/languages.ts`:
   ```ts
   export const languages = {
     en: { name: 'English', flag: '🇬🇧' },
     cs: { name: 'Čeština', flag: '🇨🇿' },
     de: { name: 'Deutsch', flag: '🇩🇪' },  // new
   } as const;
   ```

2. Copy `src/locales/en.json` to `src/locales/de.json` and translate all values.

3. Import and register in `src/lib/i18n.ts`:
   ```ts
   import de from '../locales/de.json';
   const dictionaries: Record<string, Record<string, string>> = { en, cs, de };
   ```

4. Add to `astro.config.mjs`:
   ```js
   i18n: {
     locales: ['en', 'cs', 'de'],
     fallback: { cs: 'en', de: 'en' }
   }
   ```

The language picker updates automatically.

---

## Fixing / Improving an Existing Tool

- Component: `src/components/tools/<ToolName>.svelte`
- Crypto logic: `src/lib/crypto.ts`
- Page wrapper: `src/pages/tools/<slug>.astro`
- Translations: `src/locales/*.json` — search for `tools.<toolName>.`

---

## Translation Guidelines

- `en.json` is the source of truth.
- Every key in `en.json` must exist in every locale file.
- The `t()` function silently falls back to English for missing keys.
- Use flat dot-notation keys: `"tools.myTool.someLabel"`.
- For dynamic values, use `{placeholder}` replaced at runtime.

---

## Code Style

- **No unnecessary comments** — don't narrate what the code does.
- **Tailwind CSS** — prefer utility classes over custom CSS.
- **TypeScript** — use types for props, function signatures, and exports.
- **No external network calls** — all crypto must run client-side.

---

## Pull Requests

1. Fork the repo and create a feature branch.
2. Make your changes following this guide.
3. Run `yarn build` to ensure there are no build errors.
4. Open a PR with a clear title and description.

---

## File Reference

| File | Purpose |
| --- | --- |
| `src/lib/tools.ts` | Tool registry — defines all tools, their slugs, categories, and i18n keys |
| `src/lib/crypto.ts` | All cryptographic functions used by tool components |
| `src/lib/i18n.ts` | Translation utilities: `getTranslations()`, `t()`, `getLocalePath()` |
| `src/lib/languages.ts` | Language definitions (name, flag, locale code) |
| `src/locales/*.json` | Flat key-value translation dictionaries |
| `src/layouts/Layout.astro` | Shared page layout with navbar, footer, meta tags |
| `astro.config.mjs` | Astro configuration including i18n locales and Cloudflare adapter |
| `public/_headers` | Cloudflare Pages security headers |
