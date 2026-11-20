import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowLines, hashSeed } from '../src/lib/flowField';

test('the same seed and size draw the same lines', () => {
  const seed = hashSeed('abc123|/');
  assert.deepEqual(flowLines(seed, 1280, 3000), flowLines(seed, 1280, 3000));
});

test('another page or build draws different lines', () => {
  const a = flowLines(hashSeed('abc123|/'), 1280, 2000).map((l) => l.d);
  const b = flowLines(hashSeed('abc123|/install'), 1280, 2000).map((l) => l.d);
  const c = flowLines(hashSeed('def456|/'), 1280, 2000).map((l) => l.d);
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('a taller page keeps the lines that start above the old height', () => {
  const seed = hashSeed('abc123|/chat');
  const short = flowLines(seed, 1280, 1800).map((l) => l.d.split('C')[0]);
  const tall = new Set(flowLines(seed, 1280, 3600).map((l) => l.d.split('C')[0]));
  const kept = short.filter((start) => tall.has(start)).length;
  assert.ok(kept / short.length > 0.8, `${kept} of ${short.length} kept`);
});

test('line count grows with height and stays within sane bounds', () => {
  const seed = hashSeed('x');
  const small = flowLines(seed, 1280, 900).length;
  const big = flowLines(seed, 1280, 9000).length;
  assert.ok(small > 5 && small < 90, `small ${small}`);
  assert.ok(big > small * 4 && big < 900, `big ${big}`);
  for (const line of flowLines(seed, 390, 2000)) {
    assert.ok(line.opacity > 0 && line.opacity <= 1);
    assert.ok(line.width >= 1.7 && line.width <= 3.6);
  }
});

test('the classic shape keeps the original current, the seeded one reshapes it', () => {
  const seed = hashSeed('abc123|/');
  const classic = flowLines(seed, 1280, 2000, { shape: 'classic' }).map((l) => l.d);
  const seeded = flowLines(seed, 1280, 2000).map((l) => l.d);
  assert.ok(classic.length > 5);
  assert.notDeepEqual(classic, seeded);
  const density = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => flowLines(hashSeed(s), 1280, 2000).length);
  assert.ok(new Set(density).size > 1, `density ${density}`);
});
