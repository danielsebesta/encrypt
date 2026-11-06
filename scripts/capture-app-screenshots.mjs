/**
 * One-shot PWA store screenshots.
 *
 *   pnpm capture:screenshots
 *
 * Downloads CC0 Wikimedia photos into public/shots/, starts (or reuses) the
 * local Astro server, fills /app?shots=1, captures iPhone-sized PNGs, and
 * refreshes site.webmanifest screenshot entries.
 */
import { chromium, devices } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';

// Windows Node often hangs on Wikimedia IPv6; prefer v4.
dns.setDefaultResultOrder('ipv4first');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const shotsDir = join(publicDir, 'shots');
const DEFAULT_PORT = Number(process.env.SHOTS_PORT || 4331);
const BASE = (process.argv[2] || `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/$/, '');
const phone = devices['iPhone 14 Pro'];

/** Curated CC0 / Public Domain Commons files that look like real phone shares. */
const COMMONS = [
  {
    file: 'dinner.jpg',
    title: 'File:Pizza 14.jpg',
    note: 'CC0 — pizza someone would send in the group chat',
  },
  {
    file: 'dog.jpg',
    title: 'File:Fawn and white Welsh Corgi puppy standing on rear legs and sticking out the tongue.jpg',
    note: 'CC0 — classic pet photo',
  },
  {
    file: 'street.jpg',
    title: 'File:Coffee in Montreal (Unsplash).jpg',
    note: 'CC0 — cafe / trip snap',
  },
];

const captures = [
  { name: 'screenshot-hub-chats', path: '/app?shots=1&tab=chats', wait: 'Weekend crew' },
  { name: 'screenshot-chat', path: '/app?shots=1&room=weekend-crew&kind=chat', wait: 'We still on for dinner' },
  { name: 'screenshot-hub-boards', path: '/app?shots=1&tab=boards', wait: 'Trip board' },
  { name: 'screenshot-hub-files', path: '/app?shots=1&tab=files', wait: 'Drop, paste, or click' },
  { name: 'screenshot-hub-settings', path: '/app?shots=1&tab=settings', wait: 'Haptic' },
];

mkdirSync(shotsDir, { recursive: true });

const UA = 'encrypt.click-screenshot-bot/1.0 (https://encrypt.click; hello@encrypt.click)';
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl';

function curlJson(url) {
  const r = spawnSync(
    CURL,
    ['-fsSL', '-A', UA, '--max-time', '60', url],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`curl failed for ${url}: ${r.stderr || r.error}`);
  return JSON.parse(r.stdout);
}

function curlFile(url, dest) {
  const r = spawnSync(
    CURL,
    ['-fsSL', '-A', UA, '--max-time', '120', '-o', dest, url],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`curl download failed for ${url}: ${r.stderr || r.error}`);
}

function commonsThumb(title) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('titles', title);
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|mime|extmetadata');
  url.searchParams.set('iiurlwidth', '1600');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const data = curlJson(url.toString());
  const page = Object.values(data.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl && !info?.url) throw new Error(`No image URL for ${title}`);
  const meta = JSON.stringify(info.extmetadata || {});
  const license = String(info.extmetadata?.LicenseShortName?.value || info.extmetadata?.License?.value || '');
  if (!/cc0|public domain|pd-/i.test(`${license} ${meta}`)) {
    throw new Error(`Refusing ${title}: license is "${license || 'unknown'}" (need CC0 / Public Domain)`);
  }
  // Strip tracking query Commons sometimes appends.
  return String(info.thumburl || info.url).split('?')[0];
}

async function ensurePhotos() {
  console.log('Ensuring CC0 Wikimedia photos in public/shots/…');
  for (const item of COMMONS) {
    const dest = join(shotsDir, item.file);
    if (existsSync(dest) && readFileSync(dest).length > 10_000) {
      console.log(`  keep ${item.file}`);
      continue;
    }
    console.log(`  fetch ${item.file} (${item.note})`);
    const src = commonsThumb(item.title);
    curlFile(src, dest);
    console.log(`  wrote ${item.file} (${readFileSync(dest).length} bytes)`);
  }
}

async function portOpen(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/app`, { redirect: 'manual' });
    return res.status > 0;
  } catch {
    return false;
  }
}

function killPort(port) {
  if (process.platform === 'win32') {
    const listed = spawnSync('cmd', ['/c', `netstat -ano | findstr :${port}`], { encoding: 'utf8' });
    const pids = new Set();
    for (const line of (listed.stdout || '').split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
    }
    return;
  }
  spawnSync('bash', ['-lc', `fuser -k ${port}/tcp 2>/dev/null || true`], { stdio: 'ignore' });
}

async function ensureServer() {
  const port = Number(new URL(BASE).port || DEFAULT_PORT);
  // Always start a dedicated Astro with the toolbar off — a reused `pnpm dev`
  // still injects astro-dev-toolbar into every frame.
  if (await portOpen(port)) {
    console.log(`Stopping existing server on :${port} so screenshots run without the Astro toolbar…`);
    killPort(port);
    await new Promise((r) => setTimeout(r, 600));
  }
  console.log(`Starting Astro on ${BASE}…`);
  const child = spawn(
    'pnpm',
    ['exec', 'astro', 'dev', '--host', '127.0.0.1', '--port', String(port), '--force'],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        BROWSER: 'none',
        ASTRO_TELEMETRY_DISABLED: '1',
        ASTRO_SCREENSHOTS: '1',
      },
      shell: true,
    },
  );
  let ready = false;
  let log = '';
  const onData = (buf) => {
    const text = buf.toString();
    log += text;
    if (/Local\s+http:\/\/127\.0\.0\.1/i.test(text) || /ready in/i.test(text)) ready = true;
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const deadline = Date.now() + 90_000;
  while (!ready && Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Astro exited early with code ${child.exitCode}\n${log.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 400));
    if (await portOpen(port)) ready = true;
  }
  if (!ready) {
    child.kill();
    throw new Error('Astro did not become ready in time');
  }
  await new Promise((r) => setTimeout(r, 800));
  return child;
}

async function captureAll() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...phone,
    colorScheme: 'dark',
    deviceScaleFactor: 3,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    // Soft keyboards / IME chrome must not appear in store shots.
    window.addEventListener('focusin', (e) => {
      const t = e.target;
      if (t && typeof t.blur === 'function' && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        t.blur();
      }
    }, true);
  });
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  const shotCss = `
      input, textarea, [contenteditable="true"] { caret-color: transparent !important; }
      .pwa-promo, [class*="Toast"], .toast { visibility: hidden !important; }
      .chat-preview-img { max-height: 140px !important; width: 100% !important; object-fit: cover !important; }
      /* Store shots must never include the Astro / Vite overlays. */
      astro-dev-toolbar,
      astro-dev-toolbar-window,
      astro-dev-toolbar-app-canvas,
      #_astro-dev-toolbar,
      vite-error-overlay { display: none !important; visibility: hidden !important; pointer-events: none !important; }
      /* Konsta iOS navbar uses a masked translucent gradient — kill it for PNGs. */
      :root[data-app-platform] .k-navbar > div:nth-child(1),
      :root[data-app-platform] .k-navbar > div:nth-child(2),
      :root[data-app-platform] .app-bar {
        background: #000 !important;
        background-image: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        opacity: 1 !important;
        mask-image: none !important;
        -webkit-mask-image: none !important;
      }
      /* Floating tabbar also lets list rows (e.g. Secret Santa) show through. */
      :root[data-app-platform] .k-toolbar,
      :root[data-app-platform] .k-tabbar,
      :root[data-app-platform] .k-toolbar-pane,
      :root[data-app-platform] .k-tabbar .k-glass {
        background: #0c0c0c !important;
        background-image: none !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;
      }
      :root[data-app-platform] .app-scroll {
        padding-bottom: calc(11.5rem + env(safe-area-inset-bottom, 0px)) !important;
      }
    `;

  const sizes = {};
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
    await page.getByText(shot.wait).first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(350);
    if (shot.name === 'screenshot-chat') {
      await page.locator('img.chat-preview-img').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      // Pin the bottom of the thread (photo + voice + second photo + PDF) in frame.
      await page.evaluate(() => {
        const el = document.querySelector('.chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(400);
    }
    const buf = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
    const file = join(publicDir, `${shot.name}.png`);
    writeFileSync(file, buf);
    sizes[shot.name] = { bytes: buf.length, ...(await (await import('sharp')).default(buf).metadata()) };
    console.log('  wrote', file, buf.length);
  }

  const { default: sharp } = await import('sharp');
  const chatPath = join(publicDir, 'screenshot-chat.png');
  const hubPath = join(publicDir, 'screenshot-hub-chats.png');
  await sharp(chatPath).png({ compressionLevel: 9 }).toFile(join(publicDir, 'screenshot-narrow.png'));

  // Wide: hub + chat side-by-side on the brand background (real store card, not a letterbox).
  const W = 1920;
  const H = 1080;
  const panelH = H - 80;
  const left = await sharp(hubPath).resize({ height: panelH }).png().toBuffer();
  const right = await sharp(chatPath).resize({ height: panelH }).png().toBuffer();
  const lm = await sharp(left).metadata();
  const rm = await sharp(right).metadata();
  const gap = 40;
  const totalW = (lm.width || 0) + (rm.width || 0) + gap;
  const originX = Math.max(0, Math.round((W - totalW) / 2));
  const originY = Math.round((H - panelH) / 2);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#08110a' } })
    .composite([
      { input: left, left: originX, top: originY },
      { input: right, left: originX + (lm.width || 0) + gap, top: originY },
    ])
    .png({ compressionLevel: 9 })
    .toFile(join(publicDir, 'screenshot-wide.png'));

  const narrowMeta = await sharp(join(publicDir, 'screenshot-narrow.png')).metadata();
  const hubMeta = await sharp(hubPath).metadata();
  const boardsMeta = await sharp(join(publicDir, 'screenshot-hub-boards.png')).metadata();

  const manifestPath = join(publicDir, 'site.webmanifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.prefer_related_applications = false;
  manifest.screenshots = [
    {
      src: '/screenshot-wide.png',
      sizes: `${W}x${H}`,
      type: 'image/png',
      form_factor: 'wide',
      label: 'Encrypt app — chats and encrypted room',
    },
    {
      src: '/screenshot-narrow.png',
      sizes: `${narrowMeta.width}x${narrowMeta.height}`,
      type: 'image/png',
      form_factor: 'narrow',
      label: 'Encrypted group chat with photos and voice',
    },
    {
      src: '/screenshot-hub-chats.png',
      sizes: `${hubMeta.width}x${hubMeta.height}`,
      type: 'image/png',
      form_factor: 'narrow',
      label: 'Saved encrypted chat rooms',
    },
    {
      src: '/screenshot-hub-boards.png',
      sizes: `${boardsMeta.width}x${boardsMeta.height}`,
      type: 'image/png',
      form_factor: 'narrow',
      label: 'Encrypted whiteboard rooms',
    },
  ];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Updated site.webmanifest screenshots');

  await browser.close();
  return sizes;
}

let server = null;
try {
  await ensurePhotos();
  server = await ensureServer();
  await captureAll();
  console.log('\nDone. Re-run anytime with: pnpm capture:screenshots');
} finally {
  if (server?.pid) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      server.kill('SIGTERM');
    }
  }
}
