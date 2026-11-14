import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = opt('base', 'http://localhost:4321');
const themes = opt('themes', 'light,dark').split(',');
const widths = opt('widths', '320,1280').split(',').map(Number);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`    ok ${label}`);
  else {
    failures += 1;
    console.log(`    FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

async function goto(page, path) {
  await page.goto(base + path, { waitUntil: 'load', timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('#site-nav');
  await page.evaluate(() => document.querySelectorAll('astro-dev-toolbar').forEach((el) => el.remove()));
}

const shownFn = ([id, want]) => {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return want === false;
  const cs = getComputedStyle(el);
  return (cs.display !== 'none' && cs.visibility !== 'hidden') === want;
};

const menuShown = (page, controlsId, want = true) =>
  page.waitForFunction(shownFn, [controlsId, want], { timeout: 5000 }).then(() => true, () => false);

const linksShown = (page, want = true) => menuShown(page, 'nav-links', want);

const waitFocus = (page, fn, arg) =>
  page.waitForFunction(fn, arg, { timeout: 5000 }).then(() => true, () => false);

const focusState = (page, menuId, index) =>
  waitFocus(page, ([m, i]) => {
    const el = document.activeElement;
    if (!el || !el.closest) return false;
    const menu = el.closest('.menu');
    if (!menu || menu.id !== m) return false;
    if (i == null) return true;
    return [...menu.querySelectorAll('a, button')].indexOf(el) === i;
  }, [menuId, index]);

const focusControls = (page, controlsId) =>
  waitFocus(page, (id) => document.activeElement && document.activeElement.getAttribute('aria-controls') === id, controlsId);

const focusId = (page, id) =>
  waitFocus(page, (v) => document.activeElement && document.activeElement.id === v, id);

const leftMenu = (page, menuId) =>
  waitFocus(page, (m) => {
    const el = document.activeElement;
    const menu = el && el.closest ? el.closest('.menu') : null;
    return !menu || menu.id !== m;
  }, menuId);

const focusInLinks = (page) =>
  waitFocus(page, () => {
    const el = document.activeElement;
    return Boolean(el && el.closest && el.closest('#nav-links'));
  });

const expandedState = (page, controlsId, want = true) =>
  waitFocus(page, ([id, w]) => {
    const el = document.querySelector(`[aria-controls="${id}"]`);
    return Boolean(el) && (el.getAttribute('aria-expanded') === 'true') === w;
  }, [controlsId, want]);

const syncOkFn = () => {
  const vis = (el) => {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const bad = [...document.querySelectorAll('[data-menu-toggle]')].some((btn) => {
    const menu = document.getElementById(btn.getAttribute('aria-controls'));
    return !menu || vis(menu) !== (btn.getAttribute('aria-expanded') === 'true');
  });
  const nav = document.getElementById('site-nav');
  const burger = document.getElementById('nav-toggle');
  const burgerBad = burger ? nav.classList.contains('nav--open') !== (burger.getAttribute('aria-expanded') === 'true') : false;
  return !bad && !burgerBad;
};

async function checkSync(page, label) {
  const ok = await page.waitForFunction(syncOkFn, null, { timeout: 5000 }).then(() => true, () => false);
  check(`${label}: aria-expanded matches visible menus and panel`, ok);
}

async function runDesktop(page) {
  const cat = page.locator('#nav-links [data-menu-toggle]').first();
  const lang = page.locator('[data-menu-toggle][aria-controls="nav-menu-lang"]');
  const catId = await cat.getAttribute('aria-controls');

  console.log('  desktop menus');
  check('two disclosure toggles present', (await page.locator('[data-menu-toggle]').count()) >= 2);
  check('burger hidden at >=768px', await page.locator('#nav-toggle').isHidden());
  await checkSync(page, 'initial');

  await cat.click();
  check('click opens category menu', (await expandedState(page, catId)) && (await menuShown(page, catId)));
  check('language menu still closed', await expandedState(page, 'nav-menu-lang', false));
  await page.waitForTimeout(700);
  await cat.click();
  check('click on open toggle closes it', (await expandedState(page, catId, false)) && (await menuShown(page, catId, false)));

  await cat.focus();
  await page.keyboard.press('ArrowDown');
  const okFirst = await focusState(page, catId, 0);
  check('ArrowDown on toggle opens and focuses first item', okFirst, okFirst ? '' : await page.evaluate(() => `active=${document.activeElement.outerHTML.slice(0, 100)} expanded=${document.querySelector('#nav-links [data-menu-toggle]').getAttribute('aria-expanded')}`));
  await page.keyboard.press('ArrowDown');
  const okNext = await focusState(page, catId, 1);
  check('ArrowDown moves to next item', okNext, okNext ? '' : await page.evaluate(() => `active=${document.activeElement.outerHTML.slice(0, 100)}`));
  await page.keyboard.press('ArrowUp');
  check('ArrowUp moves back', await focusState(page, catId, 0));
  await page.keyboard.press('End');
  const catCount = await page.evaluate((id) => document.querySelectorAll(`#${id} a, #${id} button`).length, catId);
  check('End moves to last item', await focusState(page, catId, catCount - 1));
  await page.keyboard.press('Home');
  check('Home moves to first item', await focusState(page, catId, 0));

  await page.keyboard.press('Escape');
  check('Escape closes menu', (await expandedState(page, catId, false)) && (await menuShown(page, catId, false)));
  check('Escape returns focus to toggle', await focusControls(page, catId));
  await checkSync(page, 'after Escape');

  await page.evaluate((id) => document.querySelector(`[aria-controls="${id}"]`).focus(), catId);
  await page.keyboard.press('Enter');
  check('Enter opens menu', await expandedState(page, catId));
  await page.keyboard.press('Enter');
  check('Enter on open toggle closes menu', await expandedState(page, catId, false));

  await page.evaluate((id) => document.querySelector(`[aria-controls="${id}"]`).focus(), catId);
  await page.keyboard.press('Enter');
  check('Enter reopens menu', await expandedState(page, catId));
  await page.keyboard.press('Shift+Tab');
  check('Shift+Tab out closes menu', await expandedState(page, catId, false));

  await page.evaluate((id) => document.querySelector(`[aria-controls="${id}"]`).focus(), catId);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  check('Tab out of last item closes menu', (await expandedState(page, catId, false)) && (await leftMenu(page, catId)));

  await page.evaluate((id) => document.querySelector(`[aria-controls="${id}"]`).click(), catId);
  check('synthetic click opens menu', await expandedState(page, catId));
  await page.mouse.click(10, 400);
  check('click outside closes menu', (await expandedState(page, catId, false)) && (await menuShown(page, catId, false)));

  await page.evaluate((id) => document.querySelector(`[aria-controls="${id}"]`).click(), catId);
  await lang.click();
  check('opening second menu closes the first', (await expandedState(page, catId, false)) && (await expandedState(page, 'nav-menu-lang')));
  await page.keyboard.press('Escape');
  check('Escape closes language menu and focuses its toggle', (await focusControls(page, 'nav-menu-lang')) && (await expandedState(page, 'nav-menu-lang', false)));

  await cat.hover();
  check('hover opens menu on hover desktops', await expandedState(page, catId));
  await page.mouse.move(10, 400);
  check('pointer leave closes menu', await expandedState(page, catId, false));

  await cat.hover();
  await page.mouse.move(10, 400);
  await page.evaluate((id) => document.querySelector(`#${id} a, #${id} button`).focus(), catId);
  check('focusing an item cancels pending pointer-leave close', await expandedState(page, catId));
  await page.keyboard.press('Escape');
}

async function runMobile(page) {
  const burger = page.locator('#nav-toggle');
  const cat = page.locator('#nav-links [data-menu-toggle]').first();
  const lang = page.locator('[data-menu-toggle][aria-controls="nav-menu-lang"]');
  const catId = await cat.getAttribute('aria-controls');

  console.log('  mobile panel');
  check('burger visible at <768px', await burger.isVisible());
  check('panel closed initially', (await expandedState(page, 'nav-links', false)) && (await linksShown(page, false)));

  await burger.click();
  check('burger opens panel', (await expandedState(page, 'nav-links')) && (await linksShown(page)));
  check('focus moves into panel', await focusInLinks(page));
  await checkSync(page, 'panel open');

  await cat.click();
  check('submenu expands in panel', (await expandedState(page, catId)) && (await menuShown(page, catId)));
  await cat.click();
  check('submenu toggle click collapses it', await expandedState(page, catId, false));
  await cat.click();
  await page.keyboard.press('ArrowDown');
  check('ArrowDown reaches first submenu item', await focusState(page, catId, 0));
  await page.keyboard.press('Escape');
  check('Escape closes submenu and focuses its toggle', (await focusControls(page, catId)) && (await expandedState(page, catId, false)));
  check('panel stays open after submenu Escape', await expandedState(page, 'nav-links'));
  await page.keyboard.press('Escape');
  check('second Escape closes panel', (await expandedState(page, 'nav-links', false)) && (await linksShown(page, false)));
  check('focus lands on burger', await focusId(page, 'nav-toggle'));
  await checkSync(page, 'after panel Escape');

  await burger.click();
  await cat.click();
  await page.mouse.click(160, 780);
  check('click outside closes panel and resets submenu', (await expandedState(page, 'nav-links', false)) && (await expandedState(page, catId, false)) && (await linksShown(page, false)));

  await burger.click();
  await page.evaluate(() => document.getElementById('main').focus());
  check('focus leaving nav closes panel', (await expandedState(page, 'nav-links', false)) && (await linksShown(page, false)));

  await burger.click();
  await cat.click();
  await lang.click();
  check('only one menu open at a time in panel', (await expandedState(page, catId, false)) && (await expandedState(page, 'nav-menu-lang')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await checkSync(page, 'final');
}

async function checkAriaCurrent(page) {
  await goto(page, '/share/');
  check('nav link keeps aria-current="page"', (await page.locator('#site-nav a.nav__link[aria-current="page"]').count()) >= 1);
  check('language menu keeps aria-current="page"', (await page.locator('#nav-menu-lang .menu__item[aria-current="page"]').count()) === 1);
  await goto(page, '/experiments/chat-cipher/');
  check('menu item keeps aria-current="page"', (await page.locator('#nav-links .menu__item[aria-current="page"]').count()) === 1);
}

const browser = await chromium.launch();
for (const theme of themes) {
  for (const width of widths) {
    console.log(`${theme} ${width}px`);
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
    await ctx.addInitScript((value) => localStorage.setItem('theme', value), theme);
    const page = await ctx.newPage();
    try {
      await goto(page, '/share/');
      if (width >= 768) await runDesktop(page);
      else await runMobile(page);
      await checkAriaCurrent(page);
    } catch (err) {
      failures += 1;
      console.log(`    FAIL scenario threw: ${String(err).split('\n')[0]}`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `${failures} failure(s)` : 'all keyboard nav checks passed');
process.exit(failures ? 1 : 0);
