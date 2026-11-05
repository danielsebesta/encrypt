// @ts-check
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, passthroughImageService } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import svelte from '@astrojs/svelte';
import cloudflare from '@astrojs/cloudflare';
import { getAdapter as nodeAdapter } from '@astrojs/node';

const commit = (() => {
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  return (process.env.BUILD_COMMIT_SHA || process.env.GITHUB_SHA || 'dev').slice(0, 7);
})();

// Astro invents a random key on every build to encrypt server-island props, which this site does not use. A fixed one keeps the output reproducible.
process.env.ASTRO_KEY ||= createHash('sha256').update('encrypt.click/astro-key').digest('base64');

// Server code reads config through process.env; dev has no other way to receive .env values.
if (existsSync('.env')) process.loadEnvFile('.env');

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
    define: { __APP_COMMIT__: JSON.stringify(commit) },
    plugins: [
      tailwindcss(),
    ],
    server: {
      allowedHosts: [],
    },
    // The Node image ships without node_modules, so the server build carries its dependencies.
    ...(target === 'node' ? { environments: { ssr: { resolve: { noExternal: true } }, prerender: { resolve: { noExternal: true } } } } : {}),
    optimizeDeps: {
      include: ['lz-string', 'tlock-js'],
      exclude: [
        'svelte',
        'svelte/internal',
        'svelte/internal/client',
      ],
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
