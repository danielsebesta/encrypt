import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONS } from '../src/lib/iconManifest';
import { tools } from '../src/lib/tools';
import { buildCommandItems, commandItemMatches } from '../src/lib/commandItems';

const LOCALES = ['en', 'cs', 'de', 'es', 'fr', 'sk', 'pl'] as const;
const PALETTE_KEYS = ['palette.open', 'palette.empty'] as const;

const dict = (locale: string) =>
  JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;

test('command items have labels, locale-prefixed hrefs, manifest icons, and unique ids', () => {
  const en = dict('en');
  const items = buildCommandItems('/cs', en);
  const ids = items.map((item) => item.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(items.length, tools.length + 7);

  for (const item of items) {
    assert.ok(item.label.trim().length > 0, `${item.id} has no label`);
    assert.ok(item.href.startsWith('/cs'), `${item.id} href ${item.href}`);
    assert.ok(item.icon in ICONS, `${item.id} icon ${item.icon}`);
  }

  assert.equal(items.find((item) => item.id === 'whiteboard')?.href, '/cs/whiteboard');
  assert.equal(items.find((item) => item.id === 'decrypt')?.href, '/cs/u');
  assert.equal(items.find((item) => item.id === 'chat-cipher')?.href, '/cs/experiments/chat-cipher');
  assert.deepEqual(
    items.filter((item) => item.id === 'security' || item.id === 'install' || item.id === 'licenses').map((item) => item.href),
    ['/cs/security', '/cs/install', '/cs/licenses'],
  );

  const english = buildCommandItems('', en);
  assert.ok(english.every((item) => item.href.startsWith('/')));
  assert.equal(english.find((item) => item.id === 'share')?.href, '/share');
  assert.equal(english.find((item) => item.id === 'whiteboard')?.label, 'Whiteboard');

  for (const tool of tools) {
    const item = items.find((entry) => entry.id === tool.slug);
    assert.ok(item, tool.slug);
    assert.equal(item?.icon, tool.icon);
    assert.equal(item?.label, en[tool.navLabelKey]);
  }
});

test('palette filter matches substrings and word prefixes', () => {
  assert.equal(commandItemMatches('Whiteboard', 'whi'), true);
  assert.equal(commandItemMatches('Whiteboard', 'WHI'), true);
  assert.equal(commandItemMatches('Photo cipher', 'cipher'), true);
  assert.equal(commandItemMatches('Time capsule', 'cap time'), true);
  assert.equal(commandItemMatches('Share', 'whiteboard'), false);
  assert.equal(commandItemMatches('Chat', '   '), true);
});

test('palette locale keys exist in every locale', () => {
  const en = dict('en');
  for (const locale of LOCALES) {
    const messages = dict(locale);
    for (const key of PALETTE_KEYS) {
      assert.equal(typeof messages[key], 'string', `${locale} ${key}`);
      assert.ok(messages[key].trim().length > 0, `${locale} ${key} is empty`);
      assert.notEqual(messages[key], key, `${locale} ${key}`);
      if (locale !== 'en') assert.notEqual(messages[key], en[key], `${locale} ${key} matches English`);
    }
  }
});
