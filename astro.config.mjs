// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
  output: 'static',

  vite: {
    // @ts-expect-error - Vite plugin type mismatch between Astro and @tailwindcss/vite
    plugins: [tailwindcss()]
  },

  integrations: [svelte()]
});