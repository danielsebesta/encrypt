import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aliasName } from '../src/lib/alias';

const dict = (locale: string) => JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'));

test('alias adjectives agree with the animal and follow the locale word order', () => {
  assert.equal(aliasName(dict('cs'), { a: 2, n: 18, h: 0 }), 'Smělá Volavka');
  assert.equal(aliasName(dict('cs'), { a: 2, n: 2, h: 0 }), 'Smělý Medvěd');
  assert.equal(aliasName(dict('sk'), { a: 0, n: 0, h: 0 }), 'Hbitá Líška');
  assert.equal(aliasName(dict('pl'), { a: 6, n: 1, h: 0 }), 'Mądra Sowa');
  assert.equal(aliasName(dict('de'), { a: 2, n: 0, h: 0 }), 'Kühner Fuchs');
  assert.equal(aliasName(dict('de'), { a: 2, n: 1, h: 0 }), 'Kühne Eule');
  assert.equal(aliasName(dict('es'), { a: 1, n: 7, h: 0 }), 'Foca Serena');
  assert.equal(aliasName(dict('fr'), { a: 0, n: 17, h: 0 }), 'Baleine Vive');
  assert.equal(aliasName(dict('en'), { a: 0, n: 0, h: 0 }), 'Swift Fox');
});

test('every locale defines gender and feminine forms for all alias words', () => {
  for (const locale of ['en', 'cs', 'sk', 'de', 'es', 'fr', 'pl']) {
    const d = dict(locale);
    assert.ok(d['chat.alias.format']?.includes('{adj}') && d['chat.alias.format'].includes('{animal}'), locale);
    for (let i = 0; i < 20; i++) {
      assert.ok(['m', 'f'].includes(d[`chat.alias.animal.${i}.g`]), `${locale} animal ${i}`);
      assert.ok(d[`chat.alias.adj.${i}.f`], `${locale} adj ${i}`);
    }
  }
});
