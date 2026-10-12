import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChatMode, chatModeTtlSeconds, formatDuration, checkRoomPassword, roomPasswordOk } from '../src/lib/chatRoomSettings';

test('room modes accept only the offered retention steps', () => {
  assert.equal(normalizeChatMode('live'), 'live');
  assert.equal(normalizeChatMode('ttl-30'), 'ttl-30');
  assert.equal(normalizeChatMode('ttl-86400'), 'ttl-86400');
  assert.equal(normalizeChatMode('burn'), 'ttl-10');
  assert.equal(normalizeChatMode('ttl-7'), 'live');
  assert.equal(normalizeChatMode('ttl-999999'), 'live');
  assert.equal(normalizeChatMode({}), 'live');
  assert.equal(chatModeTtlSeconds('ttl-3600'), 3600);
  assert.equal(chatModeTtlSeconds('live'), 0);
});

test('durations use the largest whole unit in each language', () => {
  assert.equal(formatDuration(5, 'en'), '5 seconds');
  assert.equal(formatDuration(60, 'en'), '1 minute');
  assert.equal(formatDuration(900, 'en'), '15 minutes');
  assert.equal(formatDuration(86400, 'en'), '1 day');
  assert.equal(formatDuration(5, 'cs'), '5 sekund');
  assert.equal(formatDuration(3600, 'cs'), '1 hodina');
});

test('room passwords need length, variety and must not echo the room name', () => {
  assert.deepEqual(checkRoomPassword('short1!', 'room'), { length: false, variety: true, distinct: true });
  assert.deepEqual(checkRoomPassword('onlylettershere', 'room'), { length: true, variety: false, distinct: true });
  assert.equal(roomPasswordOk('onlylettersbutverylongphrase', 'room'), true);
  assert.equal(roomPasswordOk('team-standup-2026', 'team-standup'), false);
  assert.equal(roomPasswordOk('Brave-Otter-42-Lamp', 'team-standup'), true);
  assert.equal(roomPasswordOk('', 'room'), false);
});
