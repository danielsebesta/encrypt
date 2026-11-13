import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tmp', 'navbar-audit');
mkdirSync(outDir, { recursive: true });

const PROD = 'https://encrypt.click/app?shots=1&tab=chats';
const LOCAL = process.env.AUDIT_URL; // e.g. http://127.0.0.1:4321/app?shots=1&tab=chats

function measure(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.k-navbar');
    if (!nav) return { error: 'no navbar' };
    const navBox = nav.getBoundingClientRect();
    const title = document.querySelector('.app-room-title') || document.querySelector('.app-hub-title');
    const titleBox = title?.getBoundingClientRect();
    const label =
      document.querySelector('.app-nav-title') ||
      document.querySelector('.app-hub-label') ||
      title;
    const labelBox = label?.getBoundingClientRect();
    const subtitle = document.querySelector('.app-room-title .app-conn-status, .app-room-title span.truncate, .app-room-title .flex');
    const subBox = subtitle?.getBoundingClientRect();
    const rightBtns = [...nav.querySelectorAll('button.app-nav-btn')].map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0);
    const leftBtns = [...nav.querySelectorAll('.k-navbar-back-link')].map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0);
    const overlap = (a, b) => a && b && !(a.right <= b.left + 2 || a.left >= b.right - 2 || a.bottom <= b.top + 2 || a.top >= b.bottom - 2);
    const centerDelta = labelBox ? (labelBox.left + labelBox.right) / 2 - (navBox.left + navBox.right) / 2 : null;
    return {
      platform: document.documentElement.dataset.appPlatform,
      titleText: (label?.textContent || '').trim().slice(0, 80),
      label: labelBox && { left: +labelBox.left.toFixed(1), right: +labelBox.right.toFixed(1), top: +labelBox.top.toFixed(1), bottom: +labelBox.bottom.toFixed(1) },
      sub: subBox && { left: +subBox.left.toFixed(1), right: +subBox.right.toFixed(1), top: +subBox.top.toFixed(1), text: (subtitle?.textContent || '').trim().slice(0, 40) },
      titleBox: titleBox && { left: +titleBox.left.toFixed(1), right: +titleBox.right.toFixed(1), top: +titleBox.top.toFixed(1) },
      centerDeltaPx: centerDelta == null ? null : +centerDelta.toFixed(1),
      overlapsRight: rightBtns.some((b) => overlap(labelBox, b) || overlap(subBox, b)),
      overlapsLeft: leftBtns.some((b) => overlap(labelBox, b) || overlap(subBox, b)),
      clippedTop: Boolean(labelBox && labelBox.top < navBox.top - 1),
      navW: +navBox.width.toFixed(1),
      rightCount: rightBtns.length,
    };
  });
}

async function shot(page, name) {
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path, clip: { x: 0, y: 0, width: 390, height: 140 } });
  return path;
}

async function openApp(page, platform, url) {
  await page.addInitScript((plat) => {
    try {
      localStorage.setItem('encrypt-app-platform', plat);
      localStorage.setItem('encrypt-app-appearance', 'dark');
    } catch {}
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
    const native = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (String(query).includes('display-mode')) {
        return {
          matches: true,
          media: query,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
          onchange: null,
        };
      }
      return native(query);
    };
  }, platform);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.k-navbar', { timeout: 30000 });
  await page.waitForTimeout(700);

  // Prefer ?platform= so shots mode keeps Konsta + tokens on the same skin.
  if (platform === 'material' || platform === 'ios') {
    const u = new URL(page.url());
    u.searchParams.set('platform', platform);
    if (u.toString() !== page.url()) {
      await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('.k-navbar', { timeout: 30000 });
      await page.waitForTimeout(700);
    }
  }
}

async function runPlatform(browser, platform) {
  const context = await browser.newContext({ ...devices['iPhone 12'], colorScheme: 'dark' });
  const page = await context.newPage();
  // Prefer local if provided; Material needs non-shots reload so local or prod both work with standalone shim.
  const url = LOCAL || PROD;
  await openApp(page, platform, url);

  const hub = await measure(page);
  const hubShot = await shot(page, `${platform}-hub`);

  let room = null;
  let roomShot = null;
  // Rooms exist only in shots mode — open shots for room bar, then force platform via CSS dataset + Konsta won't remount.
  if (platform === 'ios' || !LOCAL) {
    await page.goto(PROD, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.k-navbar', { timeout: 30000 });
    await page.waitForTimeout(500);
    if (platform === 'material') {
      // After shots mount (ios), flip stored platform and soft-navigate room after fixing CSS on prod may lag.
      await page.evaluate(() => {
        document.documentElement.dataset.appPlatform = 'material';
      });
    }
    const roomRow = page.locator('.k-list-item').first();
    if (await roomRow.count()) {
      await roomRow.click();
      await page.waitForTimeout(900);
      if (platform === 'material') {
        await page.evaluate(() => { document.documentElement.dataset.appPlatform = 'material'; });
        await page.waitForTimeout(200);
      }
      room = await measure(page);
      roomShot = await shot(page, `${platform}-room`);
    }
  }

  await context.close();
  return { platform, hub, hubShot, room, roomShot };
}

const browser = await chromium.launch({ headless: true });
const results = {};
try {
  results.ios = await runPlatform(browser, 'ios');
  results.material = await runPlatform(browser, 'material');
} catch (err) {
  results.error = String(err);
} finally {
  await browser.close();
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
