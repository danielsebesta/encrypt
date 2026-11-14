/**
 * Capture iOS + Android marketing screenshots against an already-running server.
 *
 * Uses Playwright device simulation only (no real emulator):
 *  - iPhone 17 Pro standalone viewport + iOS UA
 *  - Pixel 8 Pro standalone viewport + Android UA
 *
 *   node scripts/capture-marketing-shots.mjs [http://127.0.0.1:4322]
 */
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const BASE = (process.argv[2] || 'http://127.0.0.1:4322').replace(/\/$/, '');

/** Standalone PWA size — Playwright's stock height excludes browser chrome. */
const IPHONE_17_PRO = {
  ...devices['iPhone 17 Pro'],
  viewport: { width: 402, height: 874 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

const PIXEL_8_PRO = {
  ...devices['Pixel 8 Pro'],
  viewport: { width: 448, height: 998 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

const iosCaptures = [
  { name: 'screenshot-hub-chats', path: '/app?shots=1&platform=ios&tab=chats', wait: 'Allsafe audit' },
  { name: 'screenshot-chat', path: '/app?shots=1&platform=ios&room=fsociety&kind=chat', wait: 'Going up now.' },
  { name: 'screenshot-hub-boards', path: '/app?shots=1&platform=ios&tab=boards', wait: 'Network map' },
  { name: 'screenshot-hub-files', path: '/app?shots=1&platform=ios&tab=files', wait: 'Choose files' },
  { name: 'screenshot-hub-settings', path: '/app?shots=1&platform=ios&tab=settings', wait: 'Haptic' },
];

const androidCaptures = [
  { name: 'screenshot-android-hub-chats', path: '/app?shots=1&platform=material&tab=chats', wait: 'Allsafe audit' },
  { name: 'screenshot-android-chat', path: '/app?shots=1&platform=material&room=allsafe&kind=chat', wait: 'Allsafe audit notes from today.' },
  { name: 'screenshot-android-hub-files', path: '/app?shots=1&platform=material&tab=files', wait: 'Choose files' },
  { name: 'screenshot-android-hub-settings', path: '/app?shots=1&platform=material&tab=settings', wait: 'Haptic' },
];

function chromeCss(barBg) {
  return `
  input, textarea, [contenteditable="true"] { caret-color: transparent !important; }
  .pwa-promo, [class*="Toast"], .toast { visibility: hidden !important; }
  .chat-preview-img { max-height: 160px !important; width: 100% !important; object-fit: cover !important; }
  astro-dev-toolbar, astro-dev-toolbar-window, vite-error-overlay { display: none !important; }
  :root { --k-safe-area-top: 0px !important; --k-safe-area-bottom: 0px !important; }
  html, body, :root[data-app-platform] .k-app, :root[data-app-platform] .k-page {
    background: ${barBg} !important; background-image: none !important;
  }
  :root[data-app-platform] .k-navbar {
    padding-top: 0 !important;
  }
  :root[data-app-platform] .k-navbar > div:nth-child(1),
  :root[data-app-platform] .k-navbar > div:nth-child(2) {
    display: none !important;
  }
  :root[data-app-platform] .k-navbar [class*="opacity-0"] {
    opacity: 1 !important;
  }
  :root[data-app-platform] .app-bar {
    background: ${barBg} !important; background-image: none !important;
    backdrop-filter: none !important; mask-image: none !important; -webkit-mask-image: none !important;
  }
  /* Transparent tabbar shell — solid fill frosts itself and kills liquid glass. */
  :root[data-app-platform] .app-main-tabbar {
    background: transparent !important; background-image: none !important;
  }
  :root[data-app-platform] .app-scroll {
    padding-bottom: 2.75rem !important;
  }
  :root[data-app-platform="ios"] .app-main-tabbar .k-toolbar-pane,
  :root[data-app-platform="ios"] .app-main-tabbar .k-glass {
    background: rgba(60, 60, 67, 0.22) !important;
    background-image: none !important;
    backdrop-filter: blur(20px) saturate(2.2) !important;
    -webkit-backdrop-filter: blur(20px) saturate(2.2) !important;
    box-shadow:
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.34),
      0 8px 28px rgba(0, 0, 0, 0.35) !important;
  }
  :root[data-app-platform="ios"] .app-main-tabbar .k-toolbar-pane > .absolute.bottom-0 {
    display: none !important;
  }
`;
}

/**
 * Chromium screenshots often flatten backdrop-filter. Build liquid glass by
 * blurring the underlay (tabbar hidden) into the floating pill, then keeping
 * only icon/label pixels from a transparent-glass pass.
 */
async function frostFloatingTabbar(page, platform) {
  if (platform !== 'ios') return null;
  const pill = await page.evaluate(() => {
    const pane = document.querySelector('.app-main-tabbar .k-toolbar-pane, .app-main-tabbar .k-glass');
    if (!pane) return null;
    const r = pane.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    const dpr = window.devicePixelRatio || 1;
    return {
      x: Math.round(r.x * dpr),
      y: Math.round(r.y * dpr),
      w: Math.round(r.width * dpr),
      h: Math.round(r.height * dpr),
      radius: Math.round((Math.min(r.width, r.height) / 2) * dpr),
    };
  });
  if (!pill) return null;

  await page.evaluate(() => {
    const tab = document.querySelector('.app-main-tabbar');
    if (tab) {
      tab.dataset.shotHidden = tab.style.visibility;
      tab.style.visibility = 'hidden';
    }
  });
  const under = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
  await page.evaluate(() => {
    const tab = document.querySelector('.app-main-tabbar');
    if (!tab) return;
    tab.style.visibility = tab.dataset.shotHidden || '';
    delete tab.dataset.shotHidden;
    document.querySelectorAll('.app-main-tabbar .k-toolbar-pane, .app-main-tabbar .k-glass').forEach((el) => {
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-image', 'none', 'important');
      el.style.setProperty('backdrop-filter', 'none', 'important');
      el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
      el.style.setProperty('box-shadow', 'none', 'important');
    });
    // Hide page chrome so the icon pass is only glyphs — never list text.
    document.querySelectorAll('.app-scroll, .k-navbar, .app-hub-bar, .fab, .k-fab').forEach((el) => {
      el.dataset.shotVis = el.style.visibility;
      el.style.visibility = 'hidden';
    });
  });
  const chrome = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
  await page.evaluate(() => {
    document.querySelectorAll('[data-shot-vis]').forEach((el) => {
      el.style.visibility = el.dataset.shotVis || '';
      delete el.dataset.shotVis;
    });
  });

  const { default: sharp } = await import('sharp');
  const frosted = await sharp(under)
    .extract({ left: pill.x, top: pill.y, width: pill.w, height: pill.h })
    .blur(18)
    .modulate({ brightness: 1.18, saturation: 1.85 })
    .ensureAlpha()
    .png()
    .toBuffer();

  const plate = await sharp(frosted)
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${pill.w}" height="${pill.h}">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="rgba(255,255,255,0.2)"/>
                <stop offset="0.5" stop-color="rgba(60,60,67,0.14)"/>
                <stop offset="1" stop-color="rgba(0,0,0,0.16)"/>
              </linearGradient>
            </defs>
            <rect width="100%" height="100%" rx="${pill.radius}" ry="${pill.radius}" fill="url(#g)"/>
            <rect x="0.75" y="0.75" width="${pill.w - 1.5}" height="${pill.h - 1.5}" rx="${pill.radius}" ry="${pill.radius}" fill="none" stroke="rgba(255,255,255,0.34)" stroke-width="1.25"/>
          </svg>`,
        ),
        blend: 'over',
      },
    ])
    .png()
    .toBuffer();

  const masked = await sharp(plate)
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${pill.w}" height="${pill.h}">
            <rect width="100%" height="100%" rx="${pill.radius}" ry="${pill.radius}" fill="white"/>
          </svg>`,
        ),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();

  const chromeRaw = await sharp(chrome).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const frostedFull = await sharp(under)
    .composite([{ input: masked, left: pill.x, top: pill.y, blend: 'over' }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = frostedFull;
  const over = chromeRaw.data;
  const { width, height, channels } = info;
  const x1 = pill.x;
  const y1 = pill.y;
  const x2 = pill.x + pill.w;
  const y2 = pill.y + pill.h;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const i = (y * width + x) * channels;
      // Icon pass sits on a blank page bg — stamp glyphs/labels/active accents only.
      const bgDist =
        Math.abs(over[i] - 28) + Math.abs(over[i + 1] - 28) + Math.abs(over[i + 2] - 30);
      const lum = (over[i] + over[i + 1] + over[i + 2]) / 3;
      const chroma =
        Math.max(over[i], over[i + 1], over[i + 2]) - Math.min(over[i], over[i + 1], over[i + 2]);
      if (bgDist > 24 && (lum > 72 || chroma > 28)) {
        data[i] = over[i];
        data[i + 1] = over[i + 1];
        data[i + 2] = over[i + 2];
        data[i + 3] = over[i + 3];
      }
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

/** Paint flat near-black letterbox strips to the platform surface color. */
async function flattenEdgeBars(pngBuf, barBg) {
  const { default: sharp } = await import('sharp');
  const img = sharp(pngBuf);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const [tr, tg, tb] = barBg
    .replace('#', '')
    .match(/.{2}/g)
    .map((h) => parseInt(h, 16));
  const maxScan = Math.min(120, Math.floor(height / 8));

  const rowStats = (y) => {
    let s = 0;
    let s2 = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      s += v;
      s2 += v * v;
    }
    const m = s / width;
    return { m, sd: Math.sqrt(Math.max(0, s2 / width - m * m)) };
  };
  const paintRow = (y) => {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      data[i] = tr;
      data[i + 1] = tg;
      data[i + 2] = tb;
      data[i + 3] = 255;
    }
  };

  const surface = (tr + tg + tb) / 3;
  // Only flat letterbox strips — never UI (glass tabbar / icons have high variance).
  const isLetterbox = ({ m, sd }) => m < surface - 6 && sd < 4;
  for (let y = 0; y < maxScan; y++) {
    const st = rowStats(y);
    if (!isLetterbox(st)) break;
    paintRow(y);
  }
  for (let y = height - 1; y >= height - maxScan; y--) {
    const st = rowStats(y);
    if (!isLetterbox(st)) break;
    paintRow(y);
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function captureSuite(browser, device, platform, shots, barBg) {
  const context = await browser.newContext({ ...device, colorScheme: 'dark' });
  await context.addInitScript((skin) => {
    try {
      localStorage.setItem('encrypt-app-platform', skin);
      localStorage.setItem('encrypt-app-appearance', 'dark');
    } catch {
      /* ignore */
    }
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (/display-mode:\s*(standalone|fullscreen|minimal-ui)/i.test(String(query))) {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return false;
          },
        };
      }
      return original(query);
    };
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
  }, platform);

  const page = await context.newPage();
  await page.emulateMedia({
    colorScheme: 'dark',
    media: 'screen',
  });
  const shotCss = chromeCss(barBg);

  for (const shot of shots) {
    console.log(`[${platform}]`, `${BASE}${shot.path}`);
    await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.addStyleTag({ content: shotCss });
    await page.evaluate(() => {
      for (const sel of ['astro-dev-toolbar', 'astro-dev-toolbar-window', 'vite-error-overlay']) {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      }
    });
    await page.waitForFunction(
      (skin) => document.documentElement.dataset.appPlatform === skin && !!document.querySelector('.k-app'),
      platform,
      { timeout: 20_000 },
    );
    await page.getByText(shot.wait).first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(400);
    if (shot.name === 'screenshot-chat' || shot.name === 'screenshot-android-chat') {
      await page.locator('img.chat-preview-img').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => {
        const el = document.querySelector('.chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(400);
    }
    // Scroll hub rows under the floating pill so the frost plate has color to show.
    await page.evaluate(() => {
      const pane = document.querySelector('.app-main-tabbar .k-toolbar-pane, .app-main-tabbar .k-glass');
      const sc = document.querySelector('.app-scroll');
      const last = sc?.querySelector(':scope > .app-content:last-child');
      if (pane && sc && last) {
        const gap = pane.getBoundingClientRect().top - last.getBoundingClientRect().bottom;
        // Pull colorful row avatars into the pill so the frost plate reads as glass.
        if (gap > -140) sc.scrollTop += gap + 140;
      }
    });
    await page.waitForTimeout(200);
    const meta = await page.evaluate(() => ({
      platform: document.documentElement.dataset.appPlatform,
      size: `${innerWidth}x${innerHeight}`,
      ua: navigator.userAgent.slice(0, 72),
    }));
    console.log('  meta', meta);
    const frosted = await frostFloatingTabbar(page, platform);
    const raw =
      frosted ||
      (await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' }));
    const buf = await flattenEdgeBars(raw, barBg);
    writeFileSync(join(publicDir, `${shot.name}.png`), buf);
    console.log('  wrote', shot.name, buf.length);
  }
  await context.close();
}

// Headless and off-screen Chromium often skip backdrop-filter; keep the window on-screen.
const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=40,40', '--window-size=480,980'],
});
await captureSuite(browser, IPHONE_17_PRO, 'ios', iosCaptures, '#1c1c1e');
await captureSuite(browser, PIXEL_8_PRO, 'material', androidCaptures, '#12140e');

const { default: sharp } = await import('sharp');
await sharp(join(publicDir, 'screenshot-chat.png')).png({ compressionLevel: 9 }).toFile(join(publicDir, 'screenshot-narrow.png'));
await sharp(join(publicDir, 'screenshot-hub-chats.png')).png({ compressionLevel: 9 }).toFile(join(publicDir, 'screenshot-narrow-hub.png'));

const W = 1920;
const H = 1080;
const panelH = H - 80;
const left = await sharp(join(publicDir, 'screenshot-hub-chats.png')).resize({ height: panelH }).png().toBuffer();
const right = await sharp(join(publicDir, 'screenshot-chat.png')).resize({ height: panelH }).png().toBuffer();
const lm = await sharp(left).metadata();
const gap = 40;
const totalW = (lm.width || 0) + (await sharp(right).metadata()).width + gap;
const originX = Math.max(0, Math.round((W - totalW) / 2));
const originY = Math.round((H - panelH) / 2);
await sharp({ create: { width: W, height: H, channels: 3, background: '#08110a' } })
  .composite([
    { input: left, left: originX, top: originY },
    { input: right, left: originX + (lm.width || 0) + gap, top: originY },
  ])
  .png({ compressionLevel: 9 })
  .toFile(join(publicDir, 'screenshot-wide.png'));

await browser.close();
console.log('Done.');
