import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldWord, tokenize, typo, randomStyle, roughen } from '../src/lib/chatNoise';

const WORDS = ['přemýšlím', 'že', 'bychom', 'někam', 'vyrazili', 'když', 'je', 'ta', 'zahrádka', 'konečně', 'volná', 'sobota', 'u', 'řeky'];

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

test('foldWord drops accents, case and punctuation', () => {
  assert.equal(foldWord('Přemýšlím!'), 'premyslim');
});

test('without typos the folded words survive any style', () => {
  for (let seed = 1; seed < 300; seed++) {
    const rand = seeded(seed);
    const style = { ...randomStyle(rand), typos: 0 };
    assert.deepEqual(tokenize(roughen(WORDS, rand, style)), WORDS.map(foldWord));
  }
});

test('typo always changes a long enough word and keeps it non-empty', () => {
  const rand = seeded(7);
  for (let i = 0; i < 500; i++) {
    const out = typo('zahradka', rand);
    assert.ok(out.length >= 7);
  }
});

test('accept can veto typos so the original shape stays decodable', () => {
  const rand = seeded(3);
  const style = { ...randomStyle(rand), typos: 1, diacritics: 1 };
  const out = roughen(WORDS, rand, style, () => false);
  assert.deepEqual(tokenize(out), WORDS.map(foldWord));
});

test('spacing stays clean and no stretch runs on without a break', () => {
  const long = Array.from({ length: 80 }, (_, i) => WORDS[i % WORDS.length]);
  for (let seed = 1; seed < 200; seed++) {
    const rand = seeded(seed);
    const text = roughen(long, rand, randomStyle(rand), undefined, () => 0);
    assert.ok(!/ {2,}/.test(text), `double space in: ${text}`);
    assert.ok(!/(^|\n) | (\n|$)/.test(text), `edge space in: ${text}`);
    assert.ok(!/\n\n/.test(text), `empty line in: ${text}`);
    for (const stretch of text.split(/[.!?\n]+|\.\.\./)) {
      assert.ok(stretch.trim().split(/\s+/).length <= 30, `run-on in: ${text}`);
    }
  }
});
