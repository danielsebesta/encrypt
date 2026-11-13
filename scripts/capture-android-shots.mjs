/**
 * Material / Android showcase captures against an already-running server.
 *
 *   node scripts/capture-android-shots.mjs [http://127.0.0.1:4322]
 */
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const BASE = (process.argv[2] || 'http://127.0.0.1:4322').replace(/\/$/, '');
const phone = devices['Galaxy S24'];

const captures = [
  { name: 'screenshot-android-hub-chats', path: '/app?shots=1&platform=material&tab=chats', wait: 'Weekend trip' },
  { name: 'screenshot-android-chat', path: '/app?shots=1&platform=material&room=studio&kind=chat', wait: 'Site visit notes from today.' },
  { name: 'screenshot-android-hub-files', path: '/app?shots=1&platform=material&tab=files', wait: 'Choose files' },
  { name: 'screenshot-android-hub-settings', path: '/app?shots=1&platform=material&tab=settings', wait: 'Haptic' },
];

const shotCss = `
  input, textarea, [contenteditable="true"] { caret-color: transparent !important; }
  .pwa-promo, [class*="Toast"], .toast { visibility: hidden !important; }
  .chat-preview-img { max-height: 140px !important; width: 100% !important; object-fit: cover !important; }
  astro-dev-toolbar,
  astro-dev-toolbar-window,
  vite-error-overlay { display: none !important; visibility: hidden !important; pointer-events: none !important; }
  :root[data-app-platform] .k-navbar > div:nth-child(1),
  :root[data-app-platform] .k-navbar > div:nth-child(2),
  :root[data-app-platform] .app-bar {
    background: #12140e !important;
    background-image: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    mask-image: none !important;
    -webkit-mask-image: none !important;
  }
  :root[data-app-platform] .k-toolbar,
  :root[data-app-platform] .k-tabbar,
  :root[data-app-platform] .k-toolbar-pane,
  :root[data-app-platform] .k-tabbar .k-glass {
    background: #12140e !important;
    background-image: none !important;
  }
`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...phone,
  colorScheme: 'dark',
  deviceScaleFactor: 3,
  viewport: { width: 360, height: 780 },
});
await context.addInitScript(() => {
  try {
    localStorage.setItem('encrypt-app-platform', 'material');
    localStorage.setItem('encrypt-app-appearance', 'dark');
  } catch {
    /* ignore */
  }
  Object.defineProperty(navigator, 'standalone', { get: () => true });
  window.addEventListener(
    'focusin',
    (e) => {
      const t = e.target;
      if (
        t &&
        typeof t.blur === 'function' &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      ) {
        t.blur();
      }
    },
    true,
  );
});

const page = await context.newPage();
await page.emulateMedia({ colorScheme: 'dark' });

for (const shot of captures) {
  const url = `${BASE}${shot.path}`;
  console.log('capturing', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.addStyleTag({ content: shotCss });
  await page.evaluate(() => {
    for (const sel of ['astro-dev-toolbar', 'astro-dev-toolbar-window', 'vite-error-overlay']) {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    }
  });
  await page.waitForFunction(() => document.documentElement.dataset.appPlatform === 'material', null, {
    timeout: 15_000,
  });
  await page.getByText(shot.wait).first().waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(400);
  if (shot.name === 'screenshot-android-chat') {
    await page.locator('img.chat-preview-img').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await page.evaluate(() => {
      const el = document.querySelector('.chat-messages');
      if (el) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(400);
  }
  const platform = await page.evaluate(() => document.documentElement.dataset.appPlatform);
  const buf = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
  const file = join(publicDir, `${shot.name}.png`);
  writeFileSync(file, buf);
  console.log('  wrote', file, buf.length, 'platform=' + platform);
}

await browser.close();
console.log('Done.');
