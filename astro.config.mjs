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

  integrations: [svelte()]
});