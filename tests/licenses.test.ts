import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LOCALES = ['en', 'cs', 'de', 'es', 'fr', 'sk', 'pl'] as const;

const LICENSES_KEYS = [
  'licenses.meta.title',
  'licenses.meta.description',
  'licenses.h1',
  'licenses.lead',
  'licenses.icons.title',
  'licenses.icons.body',
  'licenses.fonts.title',
  'licenses.fonts.body',
  'licenses.deps.title',
  'licenses.deps.body',
  'licenses.link.license',
  'licenses.link.source',
  'licenses.link.fontsSans',
  'licenses.link.fontsMono',
  'licenses.link.oflSans',
  'licenses.link.oflMono',
  'licenses.link.repo',
] as const;

const dict = (locale: string) => JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;

test('en locale has the licenses keys and the footer credit', () => {
  const en = dict('en');
  assert.deepEqual(
    Object.keys(en).filter((key) => key.startsWith('licenses.')).sort(),
    [...LICENSES_KEYS].sort(),
  );
  for (const key of LICENSES_KEYS) assert.ok(en[key].trim().length > 0, key);
  assert.ok(en['home.footer.credits'].includes('Paweł Kuna'));
  assert.ok(en['home.footer.credits'].includes('MIT'));
});

test('licenses page source has no illustration call and no svg', () => {
  const source = readFileSync(new URL('../src/pages/licenses.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /illustration\(/);
  assert.doesNotMatch(source, /<svg/);
});

test('footer credit names Paweł Kuna and MIT in every locale', () => {
  for (const locale of LOCALES) {
    const credits = dict(locale)['home.footer.credits'];
    assert.match(credits, /Paweł Kuna/, locale);
    assert.match(credits, /MIT/, locale);
  }
});
