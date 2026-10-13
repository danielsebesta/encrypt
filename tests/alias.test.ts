import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aliasName, aliasKey, parseNickname, nicknameKey } from '../src/lib/alias';

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

test('nicknames allow only letters, digits, - and _ up to 24 characters', () => {
  assert.equal(parseNickname('Marek_01-x'), 'Marek_01-x');
  assert.equal(parseNickname('a'.repeat(24)), 'a'.repeat(24));
  for (const bad of ['', ' Marek', 'Marek ', 'Ma rek', 'Mаrek', 'Marek​', 'a'.repeat(25), 42, null, undefined]) {
    assert.equal(parseNickname(bad), null, JSON.stringify(bad));
  }
});

test('nickname trust keys ignore case and never collide with alias keys', () => {
  assert.equal(nicknameKey('Marek'), nicknameKey('MAREK'));
  assert.notEqual(nicknameKey('Marek'), nicknameKey('Marek_'));
  assert.notEqual(nicknameKey('1-2-3'), aliasKey({ a: 1, n: 2, h: 3 }));
});
