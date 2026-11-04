import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEDULE_PRESETS,
  formatScheduleAt,
  parseScheduledDrafts,
  readSealedDrafts,
  scheduleAt,
  scheduleStorageKey,
  validSendAt,
  writeScheduledDrafts,
  writeSealedDrafts,
  readScheduledDrafts,
} from '../src/lib/chatSchedule';

test('schedule presets stay within the allowed window', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  for (const preset of SCHEDULE_PRESETS) {
    const at = scheduleAt(preset.offsetMs, now);
    assert.equal(validSendAt(at, now), true, preset.id);
  }
  assert.equal(validSendAt(now + 1_000, now), false);
  assert.equal(validSendAt(now + 8 * 24 * 60 * 60_000, now), false);
});

test('schedule labels use relative time for near offsets', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.match(formatScheduleAt(now + 60_000, 'en', now), /minute/i);
  assert.match(formatScheduleAt(now + 3_600_000, 'en', now), /hour/i);
});

test('scheduled drafts round-trip through session storage helpers', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  } as Storage;
  const drafts = [
    { id: 'a', text: 'later', sendAt: now + 60_000, once: true, replyTo: 'm1' },
    { id: 'b', text: 'soon', sendAt: now + 30_000, once: false },
  ];
  writeScheduledDrafts(storage, 'room', 'channel', drafts);
  assert.equal(store.has(scheduleStorageKey('room', 'channel')), true);
  const restored = readScheduledDrafts(storage, 'room', 'channel', now);
  assert.deepEqual(restored.map((d) => d.id), ['b', 'a']);
  assert.equal(parseScheduledDrafts(JSON.stringify([{ id: 1 }]), now).length, 0);
  writeScheduledDrafts(storage, 'room', 'channel', []);
  assert.equal(store.has(scheduleStorageKey('room', 'channel')), false);
});

test('sealed drafts round-trip through the room key and never store plaintext', async () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  } as Storage;
  const drafts = [{ id: 'a', text: 'secret later', sendAt: now + 60_000, once: false }];
  const seal = async (text: string) => `sealed:${Buffer.from(text).toString('base64')}`;
  const open = async (sealed: string) => sealed.startsWith('sealed:') ? Buffer.from(sealed.slice(7), 'base64').toString('utf8') : null;
  await writeSealedDrafts(storage, 'room', 'channel', drafts, seal);
  const raw = store.get(scheduleStorageKey('room', 'channel'))!;
  assert.equal(raw.includes('secret later'), false);
  assert.deepEqual((await readSealedDrafts(storage, 'room', 'channel', open, now)).map((d) => d.id), ['a']);
  assert.deepEqual(await readSealedDrafts(storage, 'room', 'channel', async () => null, now), []);
  await writeSealedDrafts(storage, 'room', 'channel', [], seal);
  assert.equal(store.has(scheduleStorageKey('room', 'channel')), false);
});

test('legacy plaintext drafts still read and are resealed on the next write', async () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  } as Storage;
  writeScheduledDrafts(storage, 'room', 'channel', [{ id: 'a', text: 'old', sendAt: now + 60_000, once: false }]);
  const restored = await readSealedDrafts(storage, 'room', 'channel', async () => null, now);
  assert.deepEqual(restored.map((d) => d.id), ['a']);
  await writeSealedDrafts(storage, 'room', 'channel', restored, async (text) => `s:${text.length}`);
  assert.equal(JSON.parse(store.get(scheduleStorageKey('room', 'channel'))!).v, 2);
});
