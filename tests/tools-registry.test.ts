import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { categoryI18nKeys, categoryIcons, getNavCategories, tools } from '../src/lib/tools';
import { ICONS } from '../src/lib/iconManifest';
import { t } from '../src/lib/i18n';

const LOCALES = ['en', 'cs', 'de', 'es', 'fr', 'sk', 'pl'] as const;
const dict = (locale: string) => JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
const EXPERIMENTS = fileURLToPath(new URL('../src/pages/experiments', import.meta.url));

/** Experiment pages deliberately kept out of the navigation registry. */
const UNREGISTERED_PAGES = new Set(['aes-words']);

function toolKeys(tool: (typeof tools)[number]): string[] {
  const p = tool.i18nPrefix;
  return [tool.navLabelKey, `${p}.h1`, `${p}.subtitle`, `${p}.meta.title`, `${p}.meta.description`, `${p}.about.1.title`, `${p}.about.1`];
}

test('registry slugs and i18n prefixes are unique', () => {
  const slugs = tools.map((tool) => tool.slug);
  const prefixes = tools.map((tool) => tool.i18nPrefix);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug');
  assert.equal(new Set(prefixes).size, prefixes.length, 'duplicate i18nPrefix');
});

test('every registered tool has an icon from the manifest and a category label', () => {
  for (const tool of tools) {
    assert.ok(tool.icon in ICONS, `${tool.slug}: icon "${tool.icon}" is not in iconManifest`);
    assert.ok(tool.category in categoryI18nKeys, `${tool.slug}: unknown category ${tool.category}`);
    assert.ok(tool.category in categoryIcons, `${tool.slug}: no category icon`);
  }
});

test('every registered tool has a page, and every page is registered or explicitly exempt', () => {
  const pages = readdirSync(EXPERIMENTS).filter((f) => f.endsWith('.astro')).map((f) => f.replace(/\.astro$/, ''));
  for (const tool of tools) {
    assert.ok(existsSync(`${EXPERIMENTS}/${tool.slug}.astro`), `${tool.slug}: missing src/pages/experiments/${tool.slug}.astro`);
  }
  const registered = new Set(tools.map((tool) => tool.slug));
  const orphans = pages.filter((page) => !registered.has(page) && !UNREGISTERED_PAGES.has(page));
  assert.deepEqual(orphans, [], 'experiment pages not in src/lib/tools.ts (add them or list them in UNREGISTERED_PAGES)');
});

for (const locale of LOCALES) {
  test(`tool locale keys are present in ${locale}`, () => {
    const d = dict(locale);
    const missing = tools.flatMap((tool) => toolKeys(tool).filter((key) => !(key in d)).map((key) => `${tool.slug}: ${key}`));
    assert.deepEqual(missing, [], `missing in ${locale}.json`);
  });
}

test('getNavCategories builds labels from the dictionary and experiment hrefs', () => {
  const d = dict('en');
  const nav = getNavCategories(t, d);
  assert.equal(nav.length, Object.keys(categoryI18nKeys).length);
  const links = nav.flatMap((group) => group.tools);
  assert.equal(links.length, tools.length);
  for (const tool of tools) {
    const link = links.find((item) => item.href === `/experiments/${tool.slug}`);
    assert.ok(link, `no link for ${tool.slug}`);
    assert.equal(link.label, d[tool.navLabelKey]);
    assert.equal(link.icon, tool.icon);
  }
});
