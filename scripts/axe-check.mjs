import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = opt('base', 'http://localhost:4321');
const pages = opt('pages', '/,/share,/u,/chat,/whiteboard,/security,/install,/licenses,/cs/,/pl/share').split(',');
const themes = opt('themes', 'light,dark').split(',');
const widths = opt('widths', '390,1280').split(',').map(Number);

const browser = await chromium.launch();
let total = 0;
for (const theme of themes) {
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await ctx.addInitScript((value) => localStorage.setItem('theme', value), theme);
    const page = await ctx.newPage();
    for (const path of pages) {
      await page.goto(base + path, { waitUntil: 'networkidle', timeout: 60000 });
      await page.evaluate(() => document.querySelectorAll('astro-dev-toolbar').forEach((el) => el.remove()));
      await page.evaluate(axeSource);
      const result = await page.evaluate(() => globalThis.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] }, rules: { region: { enabled: false } } }));
      for (const v of result.violations) {
        total += 1;
        console.log(`${theme} ${width} ${path} [${v.impact}] ${v.id}: ${v.nodes.length} node(s) e.g. ${v.nodes[0].target.join(' ')}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(total ? `${total} violation group(s)` : 'no violations');
process.exit(total ? 1 : 0);
