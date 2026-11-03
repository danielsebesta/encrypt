import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEDULE_PRESETS,
  formatScheduleAt,
  parseScheduledDrafts,
  scheduleAt,
  scheduleStorageKey,
  validSendAt,
  writeScheduledDrafts,
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
