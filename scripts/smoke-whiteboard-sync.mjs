import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:4321';
const room = `sync-${Date.now().toString(36)}`;
const browser = await chromium.launch();
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message.split('\n')[0]));
  return { ctx, page };
};
const a = await mk();
await a.page.goto(`${base}/whiteboard`, { waitUntil: 'networkidle' });
await a.page.locator('input:visible').first().fill(room);
await a.page.getByRole('button', { name: /continue/i }).first().click();
await a.page.waitForTimeout(500);
await a.page.getByRole('button', { name: /open|join|enter|create|start/i }).first().click();
await a.page.waitForSelector('canvas', { timeout: 20000 });
await a.page.waitForTimeout(1500);
const link = (await a.page.locator('.invite-card__value').first().innerText()).trim();
await a.page.getByRole('button', { name: /show password/i }).click();
const password = (await a.page.locator('.invite-card__value').nth(1).innerText()).trim();
console.log('link', link, 'password length', password.length);

const b = await mk();
await b.page.goto(link, { waitUntil: 'networkidle' });
const pw = b.page.locator('input[type="password"]:visible, input[type="text"]:visible').first();
await pw.fill(password);
await b.page.getByRole('button', { name: /open|join|enter|continue|unlock/i }).first().click();
await b.page.waitForSelector('canvas', { timeout: 20000 });
await b.page.waitForTimeout(1500);

const count = async (page) => (await page.getByText(/shapes: \d+/i).first().innerText().catch(() => 'n/a'));
console.log('before', await count(a.page), await count(b.page));
const box = await a.page.locator('canvas').first().boundingBox();
await a.page.mouse.move(box.x + 200, box.y + 200);
await a.page.mouse.down();
for (let i = 0; i < 25; i++) await a.page.mouse.move(box.x + 200 + i * 8, box.y + 200 + Math.sin(i / 3) * 40);
await a.page.mouse.up();
await a.page.waitForTimeout(2500);
console.log('after', await count(a.page), await count(b.page));
await a.page.screenshot({ path: 'C:/Users/dast/AppData/Local/Temp/shots/wb-sync-a.png' });
await b.page.screenshot({ path: 'C:/Users/dast/AppData/Local/Temp/shots/wb-sync-b.png' });
await browser.close();
