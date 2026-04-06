// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import svelte from '@astrojs/svelte';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'static',
  adapter: cloudflare({ imageService: 'compile' }),

  vite: {
    // @ts-expect-error - Vite plugin type mismatch between Astro and @tailwindcss/vite
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['lz-string', 'tlock-js']
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