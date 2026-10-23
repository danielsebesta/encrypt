import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChatMode, chatModeTtlSeconds, formatDuration, checkRoomPassword, passwordBits, roomPasswordOk } from '../src/lib/chatRoomSettings';

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

test('room passwords need length, variety, real strength and must not echo the room name', () => {
  assert.deepEqual(checkRoomPassword('short1!', 'room'), { length: false, variety: true, strength: false, distinct: true });
  assert.equal(checkRoomPassword('onlylettershereandmore', 'room').variety, false);
  for (const weak of ['Password12345678', 'Iloveyou12345678!', 'Qwertyuiop123456!', 'Hello World 2024!', 'aaaaaaaaaaaaaaaaA1!', 'Tr0ub4dor&3xyzab', 'correct horse battery staple']) {
    assert.equal(roomPasswordOk(weak, 'room'), false, weak);
  }
  for (const strong of ['Bk7#pQ2z!mW9xL4v', 'Kyber-Zebra-Moth-Lamp-Fern42', 'correct horse battery staple ocean', 'Brave-Otter-42-Lamp-Cedar-Moon']) {
    assert.equal(roomPasswordOk(strong, 'room'), true, strong);
  }
  assert.equal(roomPasswordOk('team-standup-Lamp-Cedar-Moon-42', 'team-standup'), false);
  assert.equal(roomPasswordOk('', 'room'), false);
});

test('repeated words and common passwords earn no credit', () => {
  assert.ok(passwordBits('Lamp-Lamp-Lamp-Lamp-Lamp') < passwordBits('Lamp-Moth-Fern-Zebra-Cedar'));
  assert.ok(passwordBits('Password-Password') < 20);
  assert.ok(passwordBits('1990') < passwordBits('7319'));
});
