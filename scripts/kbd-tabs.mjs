import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = opt('base', 'http://localhost:4321');
const paths = opt('pages', '/,/cs/').split(',');

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`FAIL ${msg}`);
};
const check = (cond, msg) => {
  if (!cond) fail(msg);
};

const TAB_IDS = ['home-tab-send', 'home-tab-chat', 'home-tab-whiteboard'];
const PANEL_IDS = ['home-panel-send', 'home-panel-chat', 'home-panel-whiteboard'];

async function structure(page, path) {
  const info = await page.evaluate(() => {
    const tl = document.querySelector('[role="tablist"]');
    if (!tl) return { error: 'no [role="tablist"]' };
    const tabs = [...tl.querySelectorAll('[role="tab"]')];
    const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls') ?? ''));
    const allIds = tabs.map((t) => t.id).concat(panels.map((p) => p?.id ?? ''));
    return {
      label: tl.getAttribute('aria-label'),
      count: tabs.length,
      names: tabs.map((t) => (t.textContent ?? '').trim().length),
      ids: tabs.map((t) => t.id),
      controlsOk: panels.every((p) => p && p.getAttribute('role') === 'tabpanel'),
      labelledOk: panels.every((p, i) => p && p.getAttribute('aria-labelledby') === tabs[i].id),
      panelTabindex: panels.every((p) => p && p.getAttribute('tabindex') === '0'),
      uniqueIds: new Set(allIds).size === allIds.length && allIds.every(Boolean),
      chromeHidden: [...tl.children].every((c) => c.getAttribute('role') === 'tab' || c.getAttribute('aria-hidden') === 'true'),
      canvasesHidden: [...tl.querySelectorAll('canvas')].every((c) => c.getAttribute('aria-hidden') === 'true'),
    };
  });
  if (info.error) {
    fail(`${path}: ${info.error}`);
    return false;
  }
  check(info.label && info.label !== 'landing.try.label', `${path}: tablist has a translated aria-label`);
  check(info.count === 3, `${path}: tablist owns 3 tabs (got ${info.count})`);
  check(info.ids.join() === TAB_IDS.join(), `${path}: tab ids ${info.ids}`);
  check(info.names.every((n) => n > 0), `${path}: every tab has an accessible name`);
  check(info.controlsOk, `${path}: every aria-controls resolves to a role=tabpanel`);
  check(info.labelledOk, `${path}: every tabpanel is aria-labelledby its tab`);
  check(info.panelTabindex, `${path}: every tabpanel is focusable (tabindex=0)`);
  check(info.uniqueIds, `${path}: tab/panel ids are unique`);
  check(info.chromeHidden, `${path}: non-tab children of the tablist are aria-hidden`);
  check(info.canvasesHidden, `${path}: any kit canvas inside the tablist is aria-hidden`);
  return true;
}

async function snapshot(page, want) {
  return page.evaluate(
    ({ want, panelIds }) => {
      const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')];
      const el = document.getElementById(want);
      const cs = el ? getComputedStyle(el) : null;
      const panels = panelIds.map((id) => document.getElementById(id));
      const activePanel = el ? document.getElementById(el.getAttribute('aria-controls') ?? '') : null;
      return {
        selectedId: document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null,
        focusedId: document.activeElement?.id ?? null,
        selectedCount: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length,
        tabStops: tabs.map((t) => ({ id: t.id, index: t.tabIndex })),
        activePanelVisible: activePanel ? !activePanel.hidden && activePanel.checkVisibility() : false,
        otherPanelsHidden: panels.filter((p) => p && p !== activePanel).every((p) => p.hidden && !p.checkVisibility()),
        focusVisible: el ? el.matches(':focus-visible') : false,
        outlineOk: cs ? cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 : false,
      };
    },
    { want, panelIds: PANEL_IDS },
  );
}

async function expectTab(page, path, want, how) {
  try {
    await page.waitForFunction((id) => document.querySelector('[role="tab"][aria-selected="true"]')?.id === id, want, { timeout: 4000 });
  } catch {
    return fail(`${path}: ${how} did not activate ${want}`);
  }
  const s = await snapshot(page, want);
  check(s.selectedId === want && s.selectedCount === 1, `${path}: ${how} → exactly ${want} selected`);
  check(s.focusedId === want, `${path}: ${how} → focus moved to ${want} (on ${s.focusedId})`);
  for (const t of s.tabStops) check(t.index === (t.id === want ? 0 : -1), `${path}: ${how} → roving tabindex on ${t.id} (${t.index})`);
  check(s.activePanelVisible, `${path}: ${how} → ${want} panel visible`);
  check(s.otherPanelsHidden, `${path}: ${how} → other panels hidden`);
  check(s.focusVisible, `${path}: ${how} → :focus-visible ring on ${want}`);
  check(s.outlineOk, `${path}: ${how} → visible outline on ${want}`);
}

async function audit(page, path) {
  if (!(await structure(page, path))) return;

  // Hydration probe: keep clicking until the listener flips selection.
  const selected = () => page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.id);
  let hydrated = false;
  for (let i = 0; i < 40 && !hydrated; i++) {
    try {
      await page.click('#home-tab-chat', { timeout: 800 });
    } catch {}
    hydrated = (await selected()) === 'home-tab-chat';
    if (!hydrated) await page.waitForTimeout(150);
  }
  check(hydrated, `${path}: component hydrated (chat tab activates on click)`);
  if (!hydrated) return;

  await page.keyboard.press('Home');
  await expectTab(page, path, 'home-tab-send', 'Home');
  await page.keyboard.press('ArrowRight');
  await expectTab(page, path, 'home-tab-chat', 'ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expectTab(page, path, 'home-tab-whiteboard', 'ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expectTab(page, path, 'home-tab-send', 'ArrowRight (wrap)');
  await page.keyboard.press('ArrowLeft');
  await expectTab(page, path, 'home-tab-whiteboard', 'ArrowLeft (wrap)');
  await page.keyboard.press('Home');
  await expectTab(page, path, 'home-tab-send', 'Home');
  await page.keyboard.press('End');
  await expectTab(page, path, 'home-tab-whiteboard', 'End');

  // Tab leaves the tablist and lands on the focusable panel.
  await page.keyboard.press('Tab');
  const afterTab = await page.evaluate(() => document.activeElement?.id ?? null);
  check(afterTab === 'home-panel-whiteboard', `${path}: Tab from active tab lands on its panel (on ${afterTab})`);

  // Once the lazy panel content has mounted, Tab reaches inside it.
  try {
    await page.waitForSelector('#home-panel-whiteboard input', { timeout: 10000 });
  } catch {
    fail(`${path}: whiteboard panel never gained focusable content`);
  }
  await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => !!document.activeElement?.closest?.('#home-panel-whiteboard'));
  check(inside, `${path}: Tab from the panel reaches focusable content inside it`);
  await page.keyboard.press('Shift+Tab');
  const backPanel = await page.evaluate(() => document.activeElement?.id ?? null);
  check(backPanel === 'home-panel-whiteboard', `${path}: Shift+Tab returns to the panel (on ${backPanel})`);
  await page.keyboard.press('Shift+Tab');
  const backOnTab = await page.evaluate(() => document.activeElement?.id ?? null);
  check(backOnTab === 'home-tab-whiteboard', `${path}: Shift+Tab returns to the active tab (on ${backOnTab})`);

  // Modified keys must not drive the tablist.
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(120);
  let s = await snapshot(page, 'home-tab-whiteboard');
  check(s.selectedId === 'home-tab-whiteboard', `${path}: Ctrl+Home / Shift+ArrowRight ignored (selected ${s.selectedId})`);
  check(s.focusedId === 'home-tab-whiteboard', `${path}: modified keys do not move tab focus`);

  // Enter and Space activate a programmatically focused (inactive) tab.
  await page.evaluate(() => document.getElementById('home-tab-send')?.focus());
  await page.keyboard.press('Enter');
  await expectTab(page, path, 'home-tab-send', 'Enter');
  await page.evaluate(() => document.getElementById('home-tab-chat')?.focus());
  await page.keyboard.press('Space');
  await expectTab(page, path, 'home-tab-chat', 'Space');
}

const browser = await chromium.launch();
for (const path of paths) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => document.querySelectorAll('astro-dev-toolbar').forEach((el) => el.remove()));
  await audit(page, path);
  await ctx.close();
}

// Reduced motion must keep the same keyboard contract on the plain pill.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 60000 });
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  check(reduced, '/: reduced-motion context really prefers reduced motion');
  if (await structure(page, '/ (reduced motion)')) {
    const sel = () => page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.id);
    let hydrated = false;
    for (let i = 0; i < 40 && !hydrated; i++) {
      try {
        await page.click('#home-tab-chat', { timeout: 800 });
      } catch {}
      hydrated = (await sel()) === 'home-tab-chat';
      if (!hydrated) await page.waitForTimeout(150);
    }
    if (hydrated) {
      await page.keyboard.press('ArrowRight');
      await expectTab(page, '/ (reduced motion)', 'home-tab-whiteboard', 'ArrowRight');
      check(await page.evaluate(() => { const thumb = document.querySelector('.tabs__thumb'); return !thumb || getComputedStyle(thumb).transitionDuration.split(',').every((d) => parseFloat(d) < 0.01); }), '/ (reduced motion): indicator moves without a transition');
    } else {
      fail('/ (reduced motion): component did not hydrate');
    }
  }
  await ctx.close();
}

await browser.close();
console.log(failures ? `${failures} failure(s)` : 'all checks passed');
process.exit(failures ? 1 : 0);
