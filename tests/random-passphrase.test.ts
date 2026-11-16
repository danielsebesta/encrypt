import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomIndex } from '../src/lib/random';
import { genRoomPassphrase } from '../src/lib/roomPassphrase';

test('randomIndex rejects lengths outside 1..2^32', () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x100000001]) {
    assert.throws(() => randomIndex(bad), /Invalid range/, `length ${bad}`);
  }
});

test('randomIndex stays inside [0, length) and a length of 1 always yields 0', () => {
  for (let i = 0; i < 200; i++) assert.equal(randomIndex(1), 0);
  for (const n of [2, 3, 7, 90, 256, 1000]) {
    for (let i = 0; i < 500; i++) {
      const v = randomIndex(n);
      assert.ok(Number.isInteger(v) && v >= 0 && v < n, `${v} outside [0, ${n})`);
    }
  }
});

test('randomIndex is close to uniform for a non-power-of-two length', () => {
  const n = 3;
  const draws = 30000;
  const counts = [0, 0, 0];
  for (let i = 0; i < draws; i++) counts[randomIndex(n)]++;
  for (const c of counts) assert.ok(Math.abs(c - draws / n) < draws * 0.02, `bucket count ${c} far from ${draws / n}`);
});

test('genRoomPassphrase: eight capitalised words with exactly one two-digit number attached', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const phrase = genRoomPassphrase();
    seen.add(phrase);
    const parts = phrase.split('-');
    assert.equal(parts.length, 8, phrase);
    const numbered = parts.filter((p) => /\d/.test(p));
    assert.equal(numbered.length, 1, phrase);
    assert.match(numbered[0], /^(\d{2}[A-Z][a-z]{2,3}|[A-Z][a-z]{2,3}\d{2})$/, phrase);
    for (const p of parts.filter((p) => !/\d/.test(p))) assert.match(p, /^[A-Z][a-z]{2,3}$/, phrase);
  }
  assert.equal(seen.size, 300, 'passphrases should not repeat across 300 draws');
});
