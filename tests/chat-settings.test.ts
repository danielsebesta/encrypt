import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChatMode, chatModeTtlSeconds, formatDuration, checkRoomPassword, passwordBits, roomPasswordOk } from '../src/lib/chatRoomSettings';
import { generatePassphrase } from '../src/lib/passphrase';

test('room modes accept only the offered retention steps', () => {
  assert.equal(normalizeChatMode('live'), 'live');
  assert.equal(normalizeChatMode('ttl-30'), 'ttl-30');
  assert.equal(normalizeChatMode('ttl-86400'), 'ttl-86400');
  assert.equal(normalizeChatMode('burn'), 'live');
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

test('the shared passphrase generator always passes the password check it is offered next to', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const passphrase = generatePassphrase();
    assert.ok(roomPasswordOk(passphrase, ''), passphrase);
    assert.equal(passphrase.split('-').length, 8);
    seen.add(passphrase);
  }
  assert.equal(seen.size, 500);
});

test('patterns dressed up as random characters do not pass the password check', () => {
  for (const weak of [
    'Aa1!Aa1!Aa1!Aa1!', 'aB3$aB3$aB3$aB3$', 'Xy1!Xy1!Xy1!Xy1!Xy1!', 'Xx1!Xx1!Xx1!Xx1!Xx1!Xx1!', 'Aa1!Aa1!Aa1!Aa2!',
    '1q2w3e4r5t6y7u8i!A', 'Qw3Er4Ty5Ui6Op7As', 'a1!b2@c3#d4$e5%f6^', '1qaz2wsx3edc4rfv!A', 'Tr0ub4dor&3Tr0ub4dor&3', 'Tr0ub4dor&3tR0UB4DOR&4',
    'P@ssw0rd!P@ssw0rd!', 'P@ssw0rd-Xk7#9-2024', 'Abcd1234!!4321dcbA', 'Aa1!Bb2@Cc3#Dd4$', '+ěščřžýáíé+ěščřžýáíé',
  ]) assert.equal(roomPasswordOk(weak, 'room'), false, weak);
});

test('random and generated passwords keep passing the password check', () => {
  const pick = (alphabet: string, count: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(count)), (value) => alphabet[value % alphabet.length]).join('');
  const room = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const printable = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<=>?@[]^_{|}~';
  let grouped = 0;
  let plain = 0;
  for (let i = 0; i < 2000; i++) {
    const chars = pick(room, 20);
    if (roomPasswordOk([0, 5, 10, 15].map((at) => chars.slice(at, at + 5)).join('-'), '')) grouped++;
    if (roomPasswordOk(pick(printable, 20), '')) plain++;
  }
  assert.ok(grouped >= 1990, `${grouped} of 2000`);
  assert.ok(plain >= 1990, `${plain} of 2000`);
  assert.equal(roomPasswordOk('Cedar-Lamp-Moth-Fern-Zebra-Otter-Plum42-Grape', ''), true);
});

test('a very long password is estimated without hanging', () => {
  const started = Date.now();
  passwordBits('Xy1!'.repeat(100_000));
  assert.ok(Date.now() - started < 1000);
});
