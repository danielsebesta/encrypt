import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LOCK_AFTER_MS, fromBase64Url, shouldLock, toBase64Url } from '../src/lib/appLock';

describe('app lock', () => {
  it('locks only after the background grace period', () => {
    assert.equal(shouldLock(0, 1_000_000), false);
    assert.equal(shouldLock(1000, 1000 + LOCK_AFTER_MS - 1), false);
    assert.equal(shouldLock(1000, 1000 + LOCK_AFTER_MS), true);
  });

  it('locks immediately when the timeout is zero', () => {
    assert.equal(shouldLock(1000, 1001, 0), true);
    assert.equal(shouldLock(0, 1001, 0), false);
  });

  it('honours a custom grace period', () => {
    assert.equal(shouldLock(1000, 1000 + 59_999, 60_000), false);
    assert.equal(shouldLock(1000, 1000 + 60_000, 60_000), true);
  });

  it('round-trips credential ids', () => {
    const bytes = Uint8Array.from([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
    const text = toBase64Url(bytes);
    assert.match(text, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(Array.from(fromBase64Url(text)), Array.from(bytes));
  });
});
