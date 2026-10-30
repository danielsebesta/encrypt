import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldWord, typo } from '../src/lib/chatNoise';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

test('foldWord drops accents, case and punctuation', () => {
  assert.equal(foldWord('Přemýšlím!'), 'premyslim');
});

test('typo keeps a long enough word non-empty', () => {
  const rand = seeded(7);
  for (let i = 0; i < 500; i++) {
    const out = typo('zahradka', rand);
    assert.ok(out.length >= 7);
  }
});
