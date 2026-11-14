import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:4321';
const browser = await chromium.launch();
let failed = 0;
for (const [start, expected, query] of [['/', '/whiteboard', 'whi'], ['/cs/', '/cs/whiteboard', 'tabu']]) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(base + start, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+K');
  const input = page.getByRole('combobox');
  await input.waitFor({ state: 'visible' });
  await input.type(query);
  const active = await page.locator('[role=option][aria-selected=true]').first().innerText();
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname.startsWith(expected), { timeout: 15000 }).catch(() => {});
  const path = new URL(page.url()).pathname.replace(/\/$/, '');
  const ok = path === expected;
  if (!ok) failed += 1;
  console.log(start, 'active:', active.trim(), '-> ', path, ok ? 'OK' : `FAIL (expected ${expected})`);
}
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.keyboard.press('Control+K');
await page.getByRole('combobox').type('zzzzqq');
console.log('empty state visible:', await page.getByRole('dialog').innerText().then((t) => t.trim().length > 0));
await page.keyboard.press('Escape');
console.log('closed on Escape:', !(await page.getByRole('dialog').isVisible().catch(() => false)));
await browser.close();
process.exit(failed ? 1 : 0);
