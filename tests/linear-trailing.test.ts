import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimTrailing } from '../src/lib/trailing';
import { parseBurnSuffix } from '../src/lib/chatRoomSettings';
import { arrayToB64url } from '../src/lib/chatCrypto';

const N = 100000;

function elapsed(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

test('trimTrailing matches the regex it replaces', () => {
  for (const s of ['', '=', '==', 'abc', 'abc=', 'abc==', '=a=', 'a/b//', '///']) {
    assert.equal(trimTrailing(s, '='), s.replace(/=+$/g, ''));
    assert.equal(trimTrailing(s, '/'), s.replace(/\/+$/g, ''));
  }
});

test('trimTrailing is linear on adversarial input', () => {
  assert.ok(elapsed(() => trimTrailing('='.repeat(N) + 'x', '=')) < 50);
  assert.ok(elapsed(() => trimTrailing('/'.repeat(N) + 'x', '/')) < 50);
  assert.equal(trimTrailing('='.repeat(N), '='), '');
});

test('arrayToB64url strips padding', () => {
  assert.equal(arrayToB64url(new Uint8Array([251, 255])), '-_8');
  assert.equal(arrayToB64url(new Uint8Array([1])), 'AQ');
  assert.equal(arrayToB64url(new Uint8Array([1, 2, 3])), 'AQID');
});

test('parseBurnSuffix handles valid suffixes', () => {
  assert.deepEqual(parseBurnSuffix('hello !30'), { text: 'hello', ttl: 30 });
  assert.deepEqual(parseBurnSuffix('hello!5'), { text: 'hello', ttl: 5 });
  assert.deepEqual(parseBurnSuffix('hi   \t !2,5'), { text: 'hi', ttl: 3 });
  assert.deepEqual(parseBurnSuffix('hi !0'), { text: 'hi', ttl: 1 });
  assert.deepEqual(parseBurnSuffix('hi !99999'), { text: 'hi', ttl: 3600 });
  assert.deepEqual(parseBurnSuffix('hi !1.'), { text: 'hi', ttl: 1 });
  assert.equal(parseBurnSuffix('hello'), null);
  assert.equal(parseBurnSuffix('!10'), null);
  assert.equal(parseBurnSuffix('  !10'), null);
  assert.equal(parseBurnSuffix('hi !1234567890'), null);
  assert.equal(parseBurnSuffix('hi !30 x'), null);
});

test('parseBurnSuffix is linear on adversarial input', () => {
  assert.ok(elapsed(() => parseBurnSuffix(' '.repeat(N) + 'x')) < 50);
  assert.ok(elapsed(() => parseBurnSuffix('a' + ' '.repeat(N) + '!')) < 50);
  assert.ok(elapsed(() => parseBurnSuffix('!1.'.repeat(N / 3) + 'x')) < 50);
  assert.ok(elapsed(() => parseBurnSuffix('a!1.' + '1'.repeat(N) + 'x')) < 50);
});
