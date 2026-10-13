import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dict = (locale: string) => JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;

test('every locale carries exactly the English keys with the same placeholders', () => {
  const en = dict('en');
  for (const locale of ['cs', 'sk', 'de', 'es', 'fr', 'pl']) {
    const other = dict(locale);
    assert.deepEqual(Object.keys(other).sort(), Object.keys(en).sort(), locale);
    for (const [key, value] of Object.entries(en)) {
      const placeholders = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
      assert.deepEqual(placeholders(other[key]), placeholders(value), `${locale} ${key}`);
      assert.ok(other[key].trim().length > 0, `${locale} ${key} is empty`);
    }
  }
});
