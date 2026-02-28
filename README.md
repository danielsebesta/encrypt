# Encrypt.click

A privacy-first, client-side security toolkit. Every tool runs 100% in your browser — no servers, no logs, no tracking.

## Tools

| Category | Tools |
| --- | --- |
| **Developer** | UUID/ULID generator, Token generator, Bcrypt hash, HMAC signer, RSA keys, SSH keys, PGP keys, JWT debugger, Base64 codec |
| **Cryptography** | AES word-based encryption, Enigma M3 simulator, Caesar cipher, Vigenère cipher, Morse code, Time capsule (timelock) |
| **Privacy** | Steganography (LSB), EXIF scrubber, ID watermarker, QR generator, PDF redactor, PDF unlocker, Dead Drop links |

## Architecture

- **Zero-knowledge** — No servers, no logs, no database. All operations happen in-browser via Web Crypto API.
- **Strict CSP** — Content Security Policy, HSTS, X-Frame-Options, Permissions-Policy.
- **Stack** — [Astro](https://astro.build) + [Svelte](https://svelte.dev) + [Tailwind CSS v4](https://tailwindcss.com). Deployed on Cloudflare Pages.

## Quick Start

```bash
yarn install
yarn dev          # http://localhost:4321
yarn build        # production build
```

## Project Structure

```
src/
├── components/
│   └── tools/          # One Svelte component per tool (interactive UI)
├── layouts/
│   └── Layout.astro    # Shared layout with navbar, footer, theme toggle
├── lib/
│   ├── crypto.ts       # All crypto functions (AES, RSA, bcrypt, etc.)
│   ├── i18n.ts         # Translation helpers: getTranslations(), t(), getLocalePath()
│   ├── languages.ts    # Language registry (add new locales here)
│   └── tools.ts        # Tool registry (add new tools here)
├── locales/
│   ├── en.json         # English translations (source of truth)
│   └── cs.json         # Czech translations
├── pages/
│   ├── index.astro     # Home page
│   ├── 404.astro       # Not found page
│   ├── security.astro  # Privacy policy
│   ├── drop.astro      # Dead Drop page
│   └── tools/          # One .astro page per tool
└── styles/
    └── global.css      # Tailwind + global styles
```

## Adding a New Tool

Adding a tool requires **4 files** and **2 registry edits**. Here's the complete checklist:

### 1. Create the Svelte component

```
src/components/tools/MyTool.svelte
```

```svelte
<script lang="ts">
  import { getTranslations, t } from '../../lib/i18n';
  export let locale = 'en';
  $: dict = getTranslations(locale);

  // your tool logic here
</script>

<div>
  <label>{t(dict, 'tools.myTool.someLabel')}</label>
  <!-- your UI here -->
</div>
```

Every user-facing string must use `t(dict, 'key')`. Never hardcode English.

### 2. Create the Astro page

```
src/pages/tools/my-tool.astro
```

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

### 3. Register the tool

In `src/lib/tools.ts`, add one entry:

```ts
{ slug: 'my-tool', i18nPrefix: 'tools.myTool', navLabelKey: 'nav.tool.myTool', category: 'developer' },
```

### 4. Add translation keys

In **every** locale file (`src/locales/en.json`, `src/locales/cs.json`, etc.) add:

```json
{
  "nav.tool.myTool": "My Tool",
  "tools.myTool.meta.title": "My Tool — encrypt.click",
  "tools.myTool.meta.description": "Description for search engines.",
  "tools.myTool.h1": "My",
  "tools.myTool.h1Highlight": "Tool.",
  "tools.myTool.subtitle": "Short description of what this tool does.",
  "tools.myTool.someLabel": "Label text"
}
```

That's it. The tool will automatically appear in the navigation and work in every language.

## Internationalization (i18n)

All user-facing text is stored in JSON files under `src/locales/`. The system uses Astro's built-in i18n routing.

### How it works

- `/` serves English (default locale, no prefix).
- `/cs/` serves Czech.
- Any new locale `xx` is served at `/xx/`.
- Astro's `fallbackType: 'rewrite'` means you don't need to duplicate pages per locale.

### Adding a new language

1. **Add locale** to `src/lib/languages.ts`:
   ```ts
   export const languages = {
     en: { name: 'English', flag: '🇬🇧' },
     cs: { name: 'Čeština', flag: '🇨🇿' },
     de: { name: 'Deutsch', flag: '🇩🇪' },  // ← new
   } as const;
   ```

2. **Create locale file** `src/locales/de.json` — copy `en.json` and translate all values.

3. **Register in i18n.ts** — add the import and dictionary entry:
   ```ts
   import de from '../locales/de.json';
   const dictionaries: Record<string, Record<string, string>> = { en, cs, de };
   ```

4. **Update Astro config** `astro.config.mjs`:
   ```js
   i18n: {
     locales: ['en', 'cs', 'de'],
     // ...
     fallback: { cs: 'en', de: 'en' }
   }
   ```

The language picker in the navbar auto-populates from `languages.ts` — no UI changes needed.

### Translation guidelines

- Every key in `en.json` must exist in every locale file.
- The `t()` function falls back to English if a key is missing.
- Use `{placeholder}` syntax for dynamic values, replaced at runtime with `.replace('{placeholder}', value)`.
- Run `node -e "..."` or the validation script to check key parity between locale files.

## Deployment

Optimized for [Cloudflare Pages](https://pages.cloudflare.com/). Configuration files:

- `wrangler.toml` — Cloudflare Workers / Pages config
- `public/_headers` — Security headers (CSP, HSTS, X-Frame-Options, etc.)

## Security

- All crypto uses the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API).
- No analytics, no tracking cookies, no third-party scripts.
- See [Security & Privacy](/security) for the full policy.

## License

[MIT](LICENSE)
