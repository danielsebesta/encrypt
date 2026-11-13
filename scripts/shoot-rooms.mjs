import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
const base = process.argv[3] || 'http://localhost:4321';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const room = `smoke-${Date.now().toString(36)}`;

async function open(kind, theme, width, shotName) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 }, reducedMotion: 'reduce', permissions: ['microphone', 'camera'] });
  await ctx.addInitScript((value) => localStorage.setItem('theme', value), theme);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', kind, e.message.split('\n')[0]));
  await page.goto(`${base}/${kind}`, { waitUntil: 'networkidle' });
  if (kind === 'chat') await page.getByRole('button', { name: /continue/i }).first().click();
  await page.getByRole('textbox').first().fill(room + kind);
  await page.getByRole('button', { name: /continue/i }).first().click();
  await page.waitForTimeout(600);
  const open = page.getByRole('button', { name: /open|join|enter|create|start/i }).first();
  await open.click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: join(out, `${shotName}.png`) });
  return { ctx, page };
}

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1280]) {
    const chat = await open('chat', theme, width, `chat-room-${width}-${theme}`);
    const box = chat.page.getByRole('textbox').last();
    await box.fill('Hello from the smoke test');
    await chat.page.keyboard.press('Enter');
    await chat.page.waitForTimeout(800);
    await chat.page.screenshot({ path: join(out, `chat-msg-${width}-${theme}.png`) });
    const call = chat.page.getByRole('button', { name: /call/i }).first();
    if (await call.count()) {
      await call.click();
      await chat.page.waitForTimeout(3000);
      await chat.page.screenshot({ path: join(out, `chat-call-${width}-${theme}.png`) });
    }
    await chat.ctx.close();
    const board = await open('whiteboard', theme, width, `board-room-${width}-${theme}`);
    await board.ctx.close();
  }
}
await browser.close();
