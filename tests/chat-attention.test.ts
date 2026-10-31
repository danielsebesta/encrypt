import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationBurst, loadNotifyPref, saveNotifyPref, titleWithUnread } from '../src/lib/chatAttention';

test('the title counts unread messages and caps the count', () => {
  assert.equal(titleWithUnread('Chat', 0), 'Chat');
  assert.equal(titleWithUnread('Chat', 3), '(3) Chat');
  assert.equal(titleWithUnread('Chat', 250), '(99+) Chat');
});

test('the notification setting is a plain flag per room and nothing else is stored', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  assert.equal(loadNotifyPref(storage, 'room'), false);
  saveNotifyPref(storage, 'room', true);
  assert.equal(loadNotifyPref(storage, 'room'), true);
  assert.equal(loadNotifyPref(storage, 'other'), false);
  assert.deepEqual([...store.values()], ['1']);
  saveNotifyPref(storage, 'room', false);
  assert.equal(store.size, 0);
  const broken = { getItem: () => { throw new Error(); }, setItem: () => { throw new Error(); }, removeItem: () => { throw new Error(); } };
  assert.equal(loadNotifyPref(broken, 'room'), false);
  saveNotifyPref(broken, 'room', true);
});

test('a burst of messages makes one notification and the next waits for a quiet gap', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    let shown = 0;
    const burst = new NotificationBurst(() => { shown++; }, Date.now, 2000, 30_000);
    for (let i = 0; i < 10; i++) { burst.note(); mock.timers.tick(100); }
    mock.timers.tick(1000);
    assert.equal(shown, 1);
    burst.note();
    mock.timers.tick(10_000);
    assert.equal(shown, 1);
    mock.timers.tick(20_000);
    assert.equal(shown, 2);
    burst.note();
    burst.cancel();
    mock.timers.tick(60_000);
    assert.equal(shown, 2);
    burst.reset();
    burst.note();
    mock.timers.tick(2000);
    assert.equal(shown, 3);
  } finally {
    mock.timers.reset();
  }
});
