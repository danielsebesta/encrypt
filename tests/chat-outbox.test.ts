import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveOutboxEntries, outboxStorageKey, readSealedOutbox, writeSealedOutbox, OUTBOX_MAX_ENTRIES, type OutboxEntry } from '../src/lib/chatOutbox';

class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

const now = 1_800_000_000_000;
const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({ id: 'm1', text: 'hello', createdAt: now - 1000, ttl: 0, ...over });
const seal = async (text: string) => `sealed:${Buffer.from(text).toString('base64')}`;
const open = async (data: string) => (data.startsWith('sealed:') ? Buffer.from(data.slice(7), 'base64').toString() : null);

test('the outbox key lives under the chat prefix panic wipe clears', () => {
  assert.ok(outboxStorageKey('room', 'chan').startsWith('encrypt.click:chat-'));
});

test('only plausible, unexpired entries survive', () => {
  const live = liveOutboxEntries([
    entry(),
    entry({ id: 'm1', text: 'dupe' }),
    entry({ id: 'old', createdAt: now - 2 * 24 * 60 * 60_000 }),
    entry({ id: 'expired', ttl: 1, createdAt: now - 5000 }),
    entry({ id: 'timed', ttl: 600 }),
    entry({ id: 'bad id!' }),
    entry({ id: 'empty', text: '   ' }),
    entry({ id: 'reply', replyTo: '<b>' }),
    { id: 'x' },
    'nope',
  ], now);
  assert.deepEqual(live.map((e) => e.id), ['m1', 'timed']);
  assert.equal(live[0].text, 'hello');
  assert.deepEqual(liveOutboxEntries('nope', now), []);
});

test('the list is capped to the newest entries', () => {
  const many = Array.from({ length: OUTBOX_MAX_ENTRIES + 10 }, (_, i) => entry({ id: `m${i}`, createdAt: now - 100_000 + i }));
  const live = liveOutboxEntries(many, now);
  assert.equal(live.length, OUTBOX_MAX_ENTRIES);
  assert.equal(live.at(-1)!.id, `m${OUTBOX_MAX_ENTRIES + 9}`);
});

test('entries are sealed at rest and read back, an empty list removes the key', async () => {
  const storage = new MemoryStorage() as unknown as Storage;
  const fresh = entry({ createdAt: Date.now() - 1000 });
  await writeSealedOutbox(storage, 'room', 'chan', [fresh], seal);
  const raw = storage.getItem(outboxStorageKey('room', 'chan'))!;
  assert.ok(!raw.includes('hello'));
  assert.deepEqual(await readSealedOutbox(storage, 'room', 'chan', open), [fresh]);
  assert.deepEqual(await readSealedOutbox(storage, 'room', 'other', open), []);
  assert.deepEqual(await readSealedOutbox(storage, 'room', 'chan', async () => null), []);
  await writeSealedOutbox(storage, 'room', 'chan', [], seal);
  assert.equal(storage.getItem(outboxStorageKey('room', 'chan')), null);
});
