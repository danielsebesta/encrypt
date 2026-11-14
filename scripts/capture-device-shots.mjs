/**
 * Marketing screenshots on real device profiles:
 *  - iOS: Playwright iPhone 17 Pro (standalone viewport 402×874 @3x)
 *  - Android: real Chrome on the booted emulator via CDP, gated as a PWA
 *    (display-mode: standalone + navigator.standalone) at Pixel 8 Pro metrics
 *
 * Prereqs for Android:
 *   adb reverse tcp:4322 tcp:4322
 *   adb forward tcp:9333 localabstract:chrome_devtools_remote
 *   Chrome open on the emulator
 *   Astro on :4322
 *
 *   node scripts/capture-device-shots.mjs [http://127.0.0.1:4322]
 */
import { chromium, devices } from 'playwright';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const BASE = (process.argv[2] || 'http://127.0.0.1:4322').replace(/\/$/, '');
const CDP = process.env.ANDROID_CDP || 'http://127.0.0.1:9333';
const ADB = process.env.ADB || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const SERIAL = process.env.ANDROID_SERIAL || 'emulator-5554';

const IPHONE_17_PRO = {
  ...devices['iPhone 17 Pro'],
  viewport: { width: 402, height: 874 },
  deviceScaleFactor: 3,
};

const PIXEL_8_PRO = { width: 448, height: 998, deviceScaleFactor: 3 };

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

/** Make /app's install gate treat the tab as an installed PWA before first paint. */
const PWA_GATE_SCRIPT = `
(() => {
  try {
    localStorage.setItem('encrypt-app-platform', 'material');
    localStorage.setItem('encrypt-app-appearance', 'dark');
  } catch {}
  Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    if (/display-mode:\\s*(standalone|fullscreen|minimal-ui)/i.test(String(query))) {
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; },
      };
    }
    return original(query);
  };
})();
`;

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
  :root[data-app-platform] .app-main-tabbar {
    background: ${barBg} !important; background-image: none !important;
  }
`;
}

async function prepPage(page, platform, barBg, wait) {
  await page.addStyleTag({ content: chromeCss(barBg) });
  await page.evaluate(() => {
    for (const sel of ['astro-dev-toolbar', 'astro-dev-toolbar-window', 'vite-error-overlay']) {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    }
  });
  await page.waitForFunction(
    (skin) => document.documentElement.dataset.appPlatform === skin && !!document.querySelector('.k-app'),
    platform,
    { timeout: 25_000 },
  );
  await page.getByText(wait).first().waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(450);
}

async function captureIos() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...IPHONE_17_PRO, colorScheme: 'dark' });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    try {
      localStorage.setItem('encrypt-app-platform', 'ios');
      localStorage.setItem('encrypt-app-appearance', 'dark');
    } catch {
      /* ignore */
    }
  });
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });

  for (const shot of iosCaptures) {
    console.log('[ios/iPhone17Pro]', `${BASE}${shot.path}`);
    await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await prepPage(page, 'ios', '#1c1c1e', shot.wait);
    if (shot.name === 'screenshot-chat') {
      await page.locator('img.chat-preview-img').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => {
        const el = document.querySelector('.chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(400);
    }
    const buf = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
    writeFileSync(join(publicDir, `${shot.name}.png`), buf);
    console.log('  wrote', shot.name, buf.length, await page.evaluate(() => `${innerWidth}x${innerHeight}`));
  }
  await browser.close();
}

function adb(...args) {
  const r = spawnSync(ADB, ['-s', SERIAL, ...args], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`adb ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').toString()}`);
  }
  return r.stdout;
}

async function screencapPng() {
  const remote = '/sdcard/encrypt-shot.png';
  adb('shell', 'screencap', '-p', remote);
  const local = join(tmpdir(), `encrypt-android-${Date.now()}.png`);
  adb('pull', remote, local);
  const buf = readFileSync(local);
  try {
    unlinkSync(local);
  } catch {
    /* ignore */
  }
  return buf;
}

async function captureAndroidCdp() {
  console.log('[android/Pixel8Pro] connecting CDP', CDP);
  adb('shell', 'wm', 'size', '1344x2992');
  adb('shell', 'wm', 'density', '480');

  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No CDP browser context — is Chrome open on the emulator?');

  // Register before any navigation so /app's inline gate sees a PWA.
  await context.addInitScript({ content: PWA_GATE_SCRIPT });

  let page = context.pages().find((p) => /4322/.test(p.url())) || context.pages()[0];
  if (!page) page = await context.newPage();

  const client = await context.newCDPSession(page);
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: PWA_GATE_SCRIPT });
  await client.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'display-mode', value: 'standalone' }],
  });
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: PIXEL_8_PRO.width,
    height: PIXEL_8_PRO.height,
    deviceScaleFactor: PIXEL_8_PRO.deviceScaleFactor,
    mobile: true,
    screenWidth: PIXEL_8_PRO.width,
    screenHeight: PIXEL_8_PRO.height,
  });

  const { default: sharp } = await import('sharp');

  for (const shot of androidCaptures) {
    const url = `${BASE}${shot.path}`;
    console.log('[android/Pixel8Pro]', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await prepPage(page, 'material', '#12140e', shot.wait);
    if (shot.name === 'screenshot-android-chat') {
      await page.locator('img.chat-preview-img').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => {
        const el = document.querySelector('.chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(400);
    }

    const meta = await page.evaluate(() => ({
      platform: document.documentElement.dataset.appPlatform,
      size: `${innerWidth}x${innerHeight}`,
      hasApp: !!document.querySelector('.k-app'),
      displayMode: matchMedia('(display-mode: standalone)').matches,
      href: location.href,
    }));
    console.log('  meta', meta);
    if (!meta.hasApp) throw new Error(`PWA gate failed for ${shot.name}: ${JSON.stringify(meta)}`);

    // CDP Page.captureScreenshot often hangs on emulator Chrome — use adb surface + crop to CSS viewport.
    const raw = await screencapPng();
    const metrics = await page.evaluate(() => {
      const vv = window.visualViewport;
      return {
        dpr: devicePixelRatio,
        innerW: innerWidth,
        innerH: innerHeight,
        screenW: screen.width,
        screenH: screen.height,
        vvW: vv?.width ?? innerWidth,
        vvH: vv?.height ?? innerHeight,
        vvLeft: vv?.offsetLeft ?? 0,
        vvTop: vv?.offsetTop ?? 0,
      };
    });
    // With metrics override, the page CSS size is Pixel 8 Pro; map to the physical screencap.
    const rawMeta = await sharp(raw).metadata();
    const scaleX = (rawMeta.width || 1344) / Math.max(metrics.screenW || PIXEL_8_PRO.width, 1);
    const scaleY = (rawMeta.height || 2992) / Math.max(metrics.screenH || PIXEL_8_PRO.height, 1);
    // Prefer visualViewport when Chrome chrome is visible; when standalone emulation
    // still leaves browser chrome, crop to the layout viewport centered under the toolbar.
    let left = Math.round(metrics.vvLeft * scaleX);
    let top = Math.round(metrics.vvTop * scaleY);
    let width = Math.round(metrics.vvW * scaleX);
    let height = Math.round(metrics.vvH * scaleY);

    // If visualViewport covers almost the whole screen, trust it; otherwise clamp to Pixel 8 Pro CSS box.
    if (height < (rawMeta.height || 0) * 0.55) {
      // Likely measured the layout viewport under Chrome UI — keep as-is.
    } else {
      // Fallback: take a centered Pixel-8-Pro-sized crop from the physical buffer.
      width = Math.round(PIXEL_8_PRO.width * PIXEL_8_PRO.deviceScaleFactor);
      height = Math.round(PIXEL_8_PRO.height * PIXEL_8_PRO.deviceScaleFactor);
      left = Math.max(0, Math.round(((rawMeta.width || width) - width) / 2));
      top = Math.max(0, Math.round(((rawMeta.height || height) - height) / 2));
    }

    width = Math.min(width, (rawMeta.width || width) - left);
    height = Math.min(height, (rawMeta.height || height) - top);

    const buf = await sharp(raw)
      .extract({ left, top, width, height })
      .resize(Math.round(PIXEL_8_PRO.width * PIXEL_8_PRO.deviceScaleFactor), Math.round(PIXEL_8_PRO.height * PIXEL_8_PRO.deviceScaleFactor), {
        fit: 'fill',
      })
      .png()
      .toBuffer();
    writeFileSync(join(publicDir, `${shot.name}.png`), buf);
    console.log('  wrote', shot.name, buf.length, `crop=${left},${top} ${width}x${height}`, 'metrics', metrics);
  }

  await browser.close();
}

async function derivatives() {
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
}

const only = process.env.SHOTS_ONLY; // ios | android
if (only !== 'android') await captureIos();
if (only !== 'ios') await captureAndroidCdp();
await derivatives();
console.log('Done.');
