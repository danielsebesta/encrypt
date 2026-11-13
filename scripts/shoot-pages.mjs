// Review screenshots: node scripts/shoot-pages.mjs <outDir> [--base http://localhost:4321] [--pages /,/share] [--widths 320,390,1280] [--themes light,dark] [--full]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const out = args[0];
if (!out) throw new Error('usage: shoot-pages.mjs <outDir> [options]');
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = opt('base', 'http://localhost:4321');
const pages = opt('pages', '/,/share,/u,/chat,/whiteboard,/tools/chat-cipher,/security').split(',');
const widths = opt('widths', '320,390,1280').split(',').map(Number);
const themes = opt('themes', 'light,dark').split(',');
const full = args.includes('--full');

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
for (const theme of themes) {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 800 : 900 }, reducedMotion: 'reduce' });
    await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
    const page = await ctx.newPage();
    for (const p of pages) {
      try {
        await page.goto(base + p, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(400);
        const name = (p === '/' ? 'home' : p.replace(/^\//, '').replace(/[\/?=&]/g, '_')) + `-${w}-${theme}.png`;
        await page.screenshot({ path: join(out, name), fullPage: full });
      } catch (e) {
        console.error('FAIL', p, w, theme, e.message.split('\n')[0]);
      }
    }
    await ctx.close();
  }
}
await browser.close();
