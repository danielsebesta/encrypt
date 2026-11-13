import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
const base = process.argv[3] || 'http://localhost:4321';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
for (const platform of ['ios', 'material']) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ ...(platform === 'ios' ? devices['iPhone 14'] : devices['Pixel 7']), colorScheme: scheme, reducedMotion: 'reduce' });
    await ctx.addInitScript(([skin, appearance]) => {
      localStorage.setItem('encrypt-app-platform', skin);
      localStorage.setItem('encrypt-app-appearance', appearance);
      Object.defineProperty(navigator, 'standalone', { get: () => true });
    }, [platform, scheme]);
    const page = await ctx.newPage();
    for (const tab of ['chats', 'settings']) {
      await page.goto(`${base}/app?shots=1&platform=${platform === 'material' ? 'android' : 'ios'}&tab=${tab}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.evaluate(() => document.querySelectorAll('astro-dev-toolbar').forEach((e) => e.remove()));
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `app-${platform}-${tab}-${scheme}.png`) });
    }
    await ctx.close();
  }
}
await browser.close();
