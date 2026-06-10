# encrypt.click

**Your privacy is just a click away.**

Privacy-first security tools that run primarily in the browser. The site is built with Astro + Svelte and ships localized UI in 7 languages.

## What ships

### Developer tools
- UUID & ULID
- Token generator
- Bcrypt hash
- HMAC signer
- RSA keys
- SSH keys
- PGP keys
- JWT debugger
- Base64

### Privacy tools
- AES Words
- Time Capsule
- Steganography
- Photo Cipher
- Spectral Cipher

### Other first-class routes
- `/` homepage with the main `UltimateEncrypt` flow
- `/u` decrypt / receive flow
- `/security` privacy and security page
- `/chat` encrypted ephemeral chat

## Current architecture

- Astro 5
- Svelte 5 for interactive tools
- Tailwind CSS v4
- Cloudflare adapter
- Astro i18n with `en`, `cs`, `de`, `es`, `fr`, `sk`, `pl`

### Important app patterns

- Tool pages are registered in [`src/lib/tools.ts`](src/lib/tools.ts).
- Every user-facing UI string belongs in the locale files under [`src/locales/`](src/locales/) (`en`, `cs`, `de`, `es`, `fr`, `sk`, `pl`).
- The education pilot lives in [`src/content/tool-education/`](src/content/tool-education/) and is loaded through [`src/lib/toolEducation.ts`](src/lib/toolEducation.ts).
- Security headers and middleware behavior live in `src/middleware.ts` and `public/_headers`.
- The encrypted upload/decrypt subsystem lives under `src/lib/ghost/` and `src/pages/api/ghost/`.

## Quick start

```bash
yarn install
yarn dev
yarn build
yarn preview
```

Local dev runs at `http://localhost:4321`.

## Project structure

```text
src/
├── components/
│   ├── home/                  # Homepage sections
│   ├── tool-education/        # Shared education UI for pilot tool pages
│   └── tools/                 # Interactive tool components
├── content/
│   └── tool-education/        # Per-tool educational content
├── layouts/
│   └── Layout.astro
├── lib/
│   ├── crypto.ts
│   ├── ghost/                 # Encrypted upload crypto/stego helpers
│   ├── i18n.ts
│   ├── languages.ts
│   ├── toolEducation.ts
│   └── tools.ts
├── locales/
│   ├── en.json
│   ├── cs.json
│   ├── de.json
│   ├── es.json
│   ├── fr.json
│   ├── sk.json
│   └── pl.json
├── pages/
│   ├── api/
│   ├── index.astro
│   ├── drop.astro
│   ├── download.astro
│   ├── security.astro
│   ├── u.astro
│   └── tools/
└── styles/
    └── global.css
```

## Adding a new tool

At minimum, a new site tool usually needs:

1. A Svelte component in `src/components/tools/`
2. An Astro page in `src/pages/tools/`
3. A registry entry in `src/lib/tools.ts`
4. Locale keys in all 7 locale files

Optionally:

- a richer explainer page like the education pilot: add content in `src/content/tool-education/` per locale and wire it through `src/lib/toolEducation.ts`

### Minimal page pattern

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

### Registry entry

```ts
{ slug: 'my-tool', i18nPrefix: 'tools.myTool', navLabelKey: 'nav.tool.myTool', category: 'developer' }
```

Valid categories:
- `developer`
- `privacy`

## Education content pilot

These tool pages already use the richer "Understand it" layer:

- `base64`
- `bcrypt`
- `jwt`
- `time-capsule`

The data format is defined in [`src/content.config.ts`](src/content.config.ts). Content lives per locale, per tool, for example:

- [`src/content/tool-education/en/base64.json`](src/content/tool-education/en/base64.json)
- [`src/content/tool-education/cs/base64.json`](src/content/tool-education/cs/base64.json)
- [`src/content/tool-education/de/base64.json`](src/content/tool-education/de/base64.json)

## Localization

- `en.json` is the source of truth.
- Every key must exist in all locale files.
- Do not hardcode English in components or pages.
- Long educational copy for the pilot tools belongs in `src/content/tool-education/`, not in the flat locale dictionaries.

Routing:

- `/` = English (default)
- `/cs/` = Czech
- `/de/` = German
- `/es/` = Spanish
- `/fr/` = French
- `/sk/` = Slovak
- `/pl/` = Polish

## Security notes

- Core crypto runs in the browser.
- Some flows intentionally use server routes for things like URL shortening, encrypted upload relays, or the drand proxy.
- Chat calls use WebRTC in TURN-only relay mode to avoid exposing peer IP addresses. Primary TURN is the self-hosted coturn server via `TURN_AUTH_SECRET` / `COTURN_AUTH_SECRET`; local dev also accepts `AUTH_SECRET`. Optional fallback can be Metered (`METERED_TURN_API_KEY` or static `METERED_TURN_USERNAME` + `METERED_TURN_CREDENTIAL`) or generic static TURN such as ExpressTURN (`EXPRESSTURN_TURN_USERNAME` + `EXPRESSTURN_TURN_CREDENTIAL`, optionally `EXPRESSTURN_TURN_URLS`). Default provider selection uses coturn when its secret is present; set `TURN_PROVIDER=metered` or `TURN_PROVIDER=expressturn` as an emergency switch if coturn is down. Without any TURN credentials, calls are disabled.
- Read `/security` for the user-facing privacy summary.

## Deployment

Optimized for Cloudflare Pages / Cloudflare adapter.

Relevant files:
- [`astro.config.mjs`](astro.config.mjs)
- [`wrangler.toml`](wrangler.toml)
- [`public/_headers`](public/_headers)

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE)
