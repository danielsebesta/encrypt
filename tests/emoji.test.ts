import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySkinTone,
  emojiName,
  getRecentEmoji,
  getSkinTone,
  isEmoji,
  loadEmojiData,
  loadEmojiNames,
  matchesEmojiGrammar,
  recordEmojiUse,
  RECENT_KEY,
  RECENT_LIMIT,
  searchEmoji,
  setSkinTone,
  stripSkinTone,
  TONE_KEY,
} from '../src/lib/emoji';

const ZWJ = '\u{200D}';
const VALID = [
  '👍', '❤️', '😂', '🔥', '👋🏽', '🫠', '🫩', '©️', '☺️', '1️⃣', '#️⃣', '🇨🇿', '🇺🇳',
  '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '👨‍👩‍👧‍👦', '👩🏻‍❤️‍💋‍👩🏼', '🧑🏻‍🤝‍🧑🏿', '🏳️‍🌈', '🏳️‍⚧️', '🕵️‍♀️', '🕵🏻‍♀️', '🏃🏾‍➡️', '😶‍🌫️', '🙂‍↔️',
];
const INVALID: unknown[] = [
  '', 'a', '1', '#', 'hi', '❤', '©', '👍👍', '👍 ', ' 👍', 'x👍', '👍x', '😀😀', '🇨🇿🇩🇪',
  String.fromCodePoint(0), `👍${String.fromCodePoint(0x200b)}`, `👍${String.fromCodePoint(0x202e)}`, '\n', '<img>',
  '👍'.repeat(20), `😀${ZWJ}`, `${ZWJ}😀`, '🏻🏻', null, undefined, 7, ['👍'], { e: '👍' },
];

test('isEmoji accepts exactly one RGI emoji of any shape', () => {
  for (const value of VALID) assert.equal(isEmoji(value), true, `should accept ${value}`);
  for (const value of INVALID) assert.equal(isEmoji(value), false, `should refuse ${JSON.stringify(value)}`);
  assert.equal(isEmoji(`😀${ZWJ}😀`), false);
  assert.equal(isEmoji('🫠'.padEnd(40, '🫠')), false);
});

test('the grammar fallback agrees on the common cases', () => {
  for (const value of VALID) assert.equal(matchesEmojiGrammar(value), true, `grammar should accept ${value}`);
  for (const value of INVALID) {
    if (typeof value === 'string') assert.equal(matchesEmojiGrammar(value), false, `grammar should refuse ${JSON.stringify(value)}`);
  }
});

test('every emoji in the dataset and each skin-tone variant is a valid emoji', async () => {
  const data = await loadEmojiData();
  let count = 0;
  for (const group of data.groups) {
    for (const entry of group.entries) {
      count += 1;
      assert.equal(isEmoji(entry.emoji), true, entry.emoji);
      if (entry.tones) for (const tone of [1, 2, 3, 4, 5] as const) assert.equal(isEmoji(applySkinTone(entry.emoji, tone)), true, applySkinTone(entry.emoji, tone));
    }
  }
  assert.ok(count > 1800);
  assert.deepEqual(data.groups.map((g) => g.id), ['smileys', 'people', 'animals', 'food', 'travel', 'activities', 'objects', 'symbols', 'flags']);
  const people = data.groups.find((g) => g.id === 'people')!;
  assert.ok(people.entries.find((e) => e.emoji === '👋')?.tones);
  assert.equal(people.entries.some((e) => /[\u{1F3FB}-\u{1F3FF}]/u.test(e.emoji)), false);
});

test('applySkinTone inserts one modifier and can take it out again', () => {
  assert.equal(applySkinTone('👋', 0), '👋');
  assert.equal(applySkinTone('👋', 3), '👋🏽');
  assert.equal(applySkinTone('👋🏽', 5), '👋🏿');
  assert.equal(applySkinTone('☝️', 1), '☝🏻');
  assert.equal(applySkinTone('🕵️‍♀️', 2), '🕵🏼‍♀️');
  assert.equal(applySkinTone('🏃‍➡️', 4), '🏃🏾‍➡️');
  assert.equal(applySkinTone('🕵🏼‍♀️', 0), '🕵️‍♀️');
  assert.equal(applySkinTone('☝🏻', 0), '☝️');
  assert.equal(applySkinTone('🧑‍🚒', 1), '🧑🏻‍🚒');
  assert.equal(stripSkinTone('🧑🏻‍🤝‍🧑🏿'), '🧑‍🤝‍🧑');
});

test('search matches word prefixes in the user language with an English fallback', async () => {
  const data = await loadEmojiData();
  const all = data.groups.flatMap((g) => g.entries.map((e) => e.emoji));
  const [en, cs] = await Promise.all([loadEmojiNames('en'), loadEmojiNames('cs')]);
  assert.equal(searchEmoji('', all, [en]).length, 0);
  assert.equal(searchEmoji('thumbs up', all, [en])[0], '👍');
  assert.ok(searchEmoji('thu', all, [en]).includes('👍'));
  assert.ok(searchEmoji('Pizza', all, [en]).includes('🍕'));
  assert.ok(searchEmoji('srdce', all, [cs]).includes('❤️'));
  assert.ok(searchEmoji('srdicko', all, [cs]).length > 0, 'diacritics are optional');
  assert.ok(searchEmoji('pizza', all, [cs, en]).includes('🍕'));
  assert.ok(searchEmoji('rocket', all, [cs, en]).includes('🚀'), 'English fallback');
  assert.equal(searchEmoji('heart', all, [en], 120, data.popular)[0], '❤️');
  assert.ok(searchEmoji('srdce', all, [cs, en], 3, data.popular).includes('❤️'));
  assert.equal(searchEmoji('fire', all, [en], 120, data.popular)[0], '🔥');
  assert.equal(searchEmoji('zzqx', all, [en]).length, 0);
  assert.deepEqual(searchEmoji('🔥', all, [en]), ['🔥']);
  assert.ok(searchEmoji('face', all, [en], 10).length <= 10);
  assert.equal(emojiName('👋🏽', cs, en), emojiName('👋', cs));
  assert.equal(emojiName('🕵🏻‍♀️', en), emojiName('🕵️‍♀️', en));
  assert.equal(loadEmojiNames('xx') === loadEmojiNames('en'), true);
});

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

test('recents rank by frequency and recency and survive bad storage', () => {
  const store = memoryStore();
  const day = 24 * 60 * 60 * 1000;
  const t0 = 1_000_000_000_000;
  assert.deepEqual(getRecentEmoji(store, t0), []);
  recordEmojiUse('😀', store, t0);
  recordEmojiUse('🔥', store, t0 + 1);
  assert.deepEqual(getRecentEmoji(store, t0 + 2), ['🔥', '😀']);
  recordEmojiUse('😀', store, t0 + 3);
  assert.deepEqual(getRecentEmoji(store, t0 + 4), ['😀', '🔥']);
  for (let i = 0; i < 3; i += 1) recordEmojiUse('🎉', store, t0 - 60 * day);
  assert.equal(getRecentEmoji(store, t0 + 5).at(-1), '🎉', 'old use fades');
  recordEmojiUse('not emoji', store, t0);
  assert.equal(getRecentEmoji(store, t0).includes('not emoji'), false);
  for (let i = 0; i < 60; i += 1) recordEmojiUse(String.fromCodePoint(0x1f400 + i), store, t0 + 10 + i);
  assert.equal(getRecentEmoji(store, t0 + 100).length, RECENT_LIMIT);
  assert.ok(JSON.parse(store.map.get(RECENT_KEY)!).length <= 48);
  assert.ok(RECENT_KEY.startsWith('encrypt.click:emoji-'));

  store.map.set(RECENT_KEY, '{oops');
  assert.deepEqual(getRecentEmoji(store), []);
  store.map.set(RECENT_KEY, JSON.stringify([{ e: '<b>', c: 1, t: 1 }, { e: '👍', c: 2, t: 1 }, 5]));
  assert.deepEqual(getRecentEmoji(store), ['👍']);
  assert.deepEqual(getRecentEmoji(null), []);
});

test('skin tone preference persists and rejects junk', () => {
  const store = memoryStore();
  assert.equal(getSkinTone(store), 0);
  setSkinTone(4, store);
  assert.equal(getSkinTone(store), 4);
  assert.ok(TONE_KEY.startsWith('encrypt.click:emoji-'));
  store.map.set(TONE_KEY, '9');
  assert.equal(getSkinTone(store), 0);
  setSkinTone(0, store);
  assert.equal(store.map.has(TONE_KEY), false);
});
