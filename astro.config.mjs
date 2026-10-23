// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig, passthroughImageService } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import svelte from '@astrojs/svelte';
import cloudflare from '@astrojs/cloudflare';
import { getAdapter as nodeAdapter } from '@astrojs/node';

const target = process.env.DEPLOY_TARGET || 'cloudflare';
if (target !== 'cloudflare' && target !== 'node') throw new Error(`Unknown DEPLOY_TARGET "${target}"`);

// The Node server (src/adapters/node/server.ts) calls the Fetch-level renderer in astro-entry.ts itself.
/** @type {import('astro').AstroIntegration} */
const node = {
  name: 'encrypt-click-node',
  hooks: {
    'astro:config:done': ({ setAdapter }) => setAdapter({
      ...nodeAdapter({ staticHeaders: false }),
      serverEntrypoint: fileURLToPath(new URL('./src/adapters/node/astro-entry.ts', import.meta.url)),
      previewEntrypoint: undefined,
    }),
  },
};

export default defineConfig({
  output: 'static',
  session: false,
  adapter: target === 'node' ? node : cloudflare({ imageService: 'passthrough' }),
  ...(target === 'node' ? { image: { service: passthroughImageService() } } : {}),

  server: {
    // Add explicitly trusted development hostnames here.
    allowedHosts: [],
  },

  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: [],
    },
    // The Node image ships without node_modules, so the server build carries its dependencies.
    ...(target === 'node' ? { ssr: { noExternal: true } } : {}),
    optimizeDeps: {
      include: ['lz-string', 'tlock-js'],
      exclude: ['svelte', 'svelte/internal', 'svelte/internal/client']
    },
    resolve: {
      dedupe: ['svelte']
    }
  },

  integrations: [svelte()],

  i18n: {
    locales: ['en', 'cs', 'de', 'es', 'fr', 'sk', 'pl'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: false,
      fallbackType: 'rewrite'
    },
    fallback: {
      cs: 'en',
      de: 'en',
      es: 'en',
      fr: 'en',
      sk: 'en',
      pl: 'en'
    }
  }
});
