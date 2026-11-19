import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPresenceState, presenceDeparture } from '../src/lib/chatPresence';
import { ToggleQueue } from '../src/lib/toggleQueue';

test('a plain leave is a departure', () => {
  const s = newPresenceState(3);
  assert.equal(presenceDeparture(s, 2, 'a'), true);
});

test('leave and join in the same tick still counts as a departure', () => {
  const s = newPresenceState(3);
  assert.equal(presenceDeparture(s, 3, 'a'), true);
});

test('a duplicate left tag is ignored', () => {
  const s = newPresenceState(3);
  assert.equal(presenceDeparture(s, 2, 'a'), true);
  assert.equal(presenceDeparture(s, 2, 'a'), false);
  assert.equal(presenceDeparture(s, 1, 'a'), false);
});

test('a reconnect under a new tag does not hide a later departure of the old one', () => {
  const s = newPresenceState(2);
  assert.equal(presenceDeparture(s, 2, 'a'), true);
  assert.equal(presenceDeparture(s, 3), false);
  assert.equal(presenceDeparture(s, 2, 'b'), true);
});

test('without a tag the count decrease is the fallback', () => {
  const s = newPresenceState(3);
  assert.equal(presenceDeparture(s, 2), true);
  assert.equal(presenceDeparture(s, 2), false);
  assert.equal(presenceDeparture(s, 3), false);
});

function harness() {
  let on = false;
  const sent: boolean[] = [];
  const release: (() => void)[] = [];
  const send = (v: boolean) => new Promise<boolean>((resolve) => {
    sent.push(v);
    release.push(() => { on = v; resolve(true); });
  });
  const flush = async () => {
    for (let i = 0; i < 10; i++) {
      while (release.length) release.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { q: new ToggleQueue(), send, sent, flush, state: () => on };
}

test('a single toggle sends once', async () => {
  const h = harness();
  const p = h.q.toggle('k', h.state, h.send);
  await h.flush();
  await p;
  assert.deepEqual(h.sent, [true]);
});

test('a rapid double click ends in the original state', async () => {
  const h = harness();
  const p = h.q.toggle('k', h.state, h.send);
  void h.q.toggle('k', h.state, h.send);
  await h.flush();
  await p;
  assert.deepEqual(h.sent, [true, false]);
  assert.equal(h.state(), false);
});

test('an odd number of clicks coalesces to the final state', async () => {
  const h = harness();
  const p = h.q.toggle('k', h.state, h.send);
  void h.q.toggle('k', h.state, h.send);
  void h.q.toggle('k', h.state, h.send);
  await h.flush();
  await p;
  assert.deepEqual(h.sent, [true]);
});

test('different keys are independent and a failed send releases the key', async () => {
  const q = new ToggleQueue();
  const sent: string[] = [];
  await q.toggle('a', () => false, async () => { sent.push('a'); return false; });
  await q.toggle('b', () => false, async () => { sent.push('b'); return true; });
  await q.toggle('a', () => false, async () => { sent.push('a2'); return true; });
  assert.deepEqual(sent, ['a', 'b', 'a2']);
});
