/**
 * Astro integration that generates standalone single-file HTML versions
 * of every encrypt.click tool during the build process.
 *
 * Output: dist/standalone/*.html
 *
 * These files are fully self-contained (CSS + JS inlined), support
 * bilingual EN/CS with a language toggle, and work offline in a browser.
 */

import path from 'path';
import { fileURLToPath } from 'url';

export default function standaloneTools() {
  return {
    name: 'standalone-tools',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        // dir is a URL object pointing to the output directory (e.g. file:///…/dist/)
        const distDir = typeof dir === 'string' ? dir : fileURLToPath(dir);
        const outDir = path.join(distDir, 'standalone');

        // Dynamic import so the generator module is only loaded at build time
        const { generateAll } = await import('./generate-standalone.mjs');
        const count = generateAll(outDir);

        console.log(`[standalone-tools] ${count} standalone HTML files written to dist/standalone/`);
      },
    },
  };
}
