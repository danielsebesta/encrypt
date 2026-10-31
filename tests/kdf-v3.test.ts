import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import { ARGON2_V3, argon2ParamsOk, argon2id, equalBytes, hkdfAesKey, hkdfBytes, hkdfKey, labelSalt } from '../src/lib/kdf';
import { padme, padPayload, validPad, PAD_MAX_CHARS, PAD_MIN_BYTES, SIGNATURE_BYTES } from '../src/lib/padding';
import { PASSWORD_ENVELOPE_OVERHEAD, openPassword, sealPassword, sealedLength } from '../src/lib/passwordEnvelope';
import { encrypt, decrypt, to14BitChunks } from '../src/lib/aesGcm';
import { encryptData, decryptData } from '../src/lib/ghost/crypto';
import { SEND_ENVELOPE_LIMIT, FIRST_PARTY_ENVELOPE_LIMIT } from '../src/lib/httpLimits';
import { accessChannel, roomSecret } from '../src/lib/roomAccess';
import {
  roomMessageKey, encryptMessage, decryptMessage, importRoomKey,
  generateSigningIdentity, signPayload, safetyNumber, keyCode,
} from '../src/lib/chatCrypto';
import { roomLookup, configStamp } from '../src/lib/chatRoomSettings';
import { stampPayload, validPayload } from '../src/lib/chatProtocol';
import { deriveBoardAccess, boardMessageBase, sealBoardMessage, openBoardMessage } from '../src/lib/whiteboardCrypto';
import { sealEnvelope, openEnvelope, stampEnvelope, validEnvelope } from '../src/lib/whiteboardProtocol';

const enc = new TextEncoder();
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const PASSWORD = 'Kyber-Zebra-Moth-Lamp-Fern42';
const utf8 = (text: string) => enc.encode(text).length;

async function pbkdf2Key(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}

test('Argon2id matches an independent implementation and refuses unsafe settings', async () => {
  const salt = enc.encode('encrypt.click v3');
  const ours = await argon2id('correct horse battery staple', salt);
  assert.equal(hex(ours), '0b3db99350124e912ab521e6229aedbe851835787bbc556681e5172d22979c2e');
  const native = (nodeCrypto as any).argon2Sync;
  if (typeof native === 'function') {
    const reference = native('argon2id', { message: 'correct horse battery staple', nonce: salt, parallelism: 1, tagLength: 32, memory: 65536, passes: 3 });
    assert.equal(hex(ours), reference.toString('hex'));
  }
  assert.deepEqual({ ...ARGON2_V3 }, { memory: 65536, iterations: 3, parallelism: 1 });
  assert.equal(argon2ParamsOk(ARGON2_V3), true);
  for (const bad of [{ memory: 4096 }, { memory: 1 << 20 }, { iterations: 0 }, { iterations: 11 }, { parallelism: 0 }, { parallelism: 5 }, { iterations: 2.5 }]) {
    assert.equal(argon2ParamsOk({ ...ARGON2_V3, ...bad }), false, JSON.stringify(bad));
    await assert.rejects(argon2id('x', salt, { ...ARGON2_V3, ...bad }), /Unsupported/);
  }
  await assert.rejects(argon2id('x', salt.slice(0, 8)), /Unsupported/);
  assert.notEqual(hex(await argon2id('correct horse battery staple', salt, { ...ARGON2_V3, memory: 8192 })), hex(ours));
});

test('HKDF helpers are RFC 5869 HKDF-SHA256 and the AES key is the HKDF output', async () => {
  const ikm = nodeCrypto.randomBytes(32);
  const salt = nodeCrypto.randomBytes(16);
  const base = await hkdfKey(ikm);
  const expected = new Uint8Array(nodeCrypto.hkdfSync('sha256', ikm, salt, 'label', 42));
  assert.deepEqual(await hkdfBytes(base, 'label', 42, salt), expected);
  assert.deepEqual(await hkdfBytes(base, 'label'), new Uint8Array(nodeCrypto.hkdfSync('sha256', ikm, new Uint8Array(), 'label', 32)));
  const iv = new Uint8Array(12);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await hkdfAesKey(base, 'aes', salt), enc.encode('hi'));
  const raw = await crypto.subtle.importKey('raw', await hkdfBytes(base, 'aes', 32, salt) as BufferSource, 'AES-GCM', false, ['decrypt']);
  assert.equal(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, raw, sealed)), 'hi');
  assert.equal(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  assert.equal(equalBytes(new Uint8Array([1]), new Uint8Array([1, 0])), false);
  assert.equal((await labelSalt('a')).length, 16);
});

test('Padmé leaves a few bits of the length and stays under 12% overhead', () => {
  assert.deepEqual([0, 1, 2, 3, 9, 330, 1000, 2 ** 20 + 1].map(padme), [0, 1, 2, 3, 10, 336, 1024, 1081344]);
  let previous = 0;
  for (let n = 1; n < 200_000; n += 97) {
    const padded = padme(n);
    assert.ok(padded >= n && padded >= previous && padded < n * 1.12 + 1, String(n));
    previous = padded;
  }
  assert.throws(() => padme(-1));
  assert.throws(() => padme(2 ** 32));
});

test('version 3 envelopes round trip, pad to Padmé sizes and keep their Argon2id settings in the header', async () => {
  for (const size of [0, 1, 5, 100, 1000, 4093, 70_000]) {
    const data = Uint8Array.from({ length: size }, (_, i) => (i * 31) % 256);
    const sealed = await sealPassword(data, 'secret');
    assert.equal(sealed.length, sealedLength(size));
    assert.equal(sealed.length, 72 + padme(4 + size) + 16);
    assert.deepEqual([...sealed.slice(0, 5)], [69, 67, 80, 51, 1]);
    const view = new DataView(sealed.buffer);
    assert.deepEqual([view.getUint32(5), view.getUint16(9), sealed[11]], [65536, 3, 1]);
    assert.deepEqual(await openPassword(sealed, 'secret'), data);
  }
  const first = await encrypt('Příliš 🔒', 'secret');
  assert.notDeepEqual(first.slice(12, 72), (await encrypt('Příliš 🔒', 'secret')).slice(12, 72));
  assert.deepEqual(await openPassword(await sealPassword([enc.encode('ab'), enc.encode('cd')], 'secret'), 'secret'), enc.encode('abcd'));
  assert.equal(PASSWORD_ENVELOPE_OVERHEAD, 92);
});

test('version 3 envelopes reject wrong passwords, forged commitments, tampering and hostile settings', async () => {
  const sealed = await sealPassword(enc.encode('attack at dawn'), 'secret');
  await assert.rejects(openPassword(sealed, 'Secret'), /Wrong password/);
  const other = await sealPassword(enc.encode('attack at dawn'), 'secret');
  const forged = sealed.slice();
  forged.set(other.slice(40, 72), 40);
  await assert.rejects(openPassword(forged, 'secret'), /Wrong password/);
  for (const offset of [0, 4, 6, 10, 11, 12, 27, 28, 39, 40, 71, 72, sealed.length - 1]) {
    const altered = sealed.slice();
    altered[offset] ^= 1;
    await assert.rejects(openPassword(altered, 'secret'), String(offset));
  }
  const hostile = sealed.slice();
  new DataView(hostile.buffer).setUint32(5, 0x7fffffff);
  await assert.rejects(openPassword(hostile, 'secret'), /Unsupported/);
  await assert.rejects(openPassword(sealed.slice(0, 91), 'secret'), /Truncated/);
  await assert.rejects(openPassword(sealed.slice(0, -1), 'secret'));
});

test('ECP2 and magic-less PBKDF2 envelopes are refused, and new ones are always ECP3', async () => {
  const magic = new Uint8Array([69, 67, 80, 50, 0, 9, 39, 192]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const seal2 = async (payload: Uint8Array) => {
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: magic }, await pbkdf2Key('secret', salt, 600_000), payload as BufferSource));
    return new Uint8Array([...magic, ...salt, ...iv, ...ct]);
  };
  await assert.rejects(decrypt(await seal2(enc.encode('old text')), 'secret'), /Unsupported/);

  const data = new Uint8Array(3000).fill(9);
  const meta = enc.encode(JSON.stringify({ name: 'a.bin', size: data.length }));
  const payload = new Uint8Array(5 + meta.length + data.length);
  new DataView(payload.buffer).setUint32(1, meta.length);
  payload.set(meta, 5);
  payload.set(data, 5 + meta.length);
  await assert.rejects(decryptData(await seal2(payload), 'secret'), /Unsupported/);

  const legacyKey = await pbkdf2Key('secret', salt, 100_000);
  const legacy = new Uint8Array([...salt, ...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, legacyKey, payload as BufferSource))]);
  await assert.rejects(openPassword(legacy, 'secret'), /Unsupported/);
  await assert.rejects(decryptData(legacy, 'secret'), /Unsupported/);

  assert.deepEqual([...(await encryptData(data, 'secret', 'a.bin')).slice(0, 4)], [69, 67, 80, 51]);
});

test('version 3 files keep strict metadata and padding never costs an upload destination', async () => {
  const data = new Uint8Array(20000).fill(7);
  const meta = enc.encode(JSON.stringify({ name: 'a.txt', size: data.length }));
  const wrapped = await sealPassword(new Uint8Array([meta.length, ...meta, ...data]), 'secret');
  await assert.rejects(decryptData(wrapped, 'secret'), /metadata/);
  const truthful = await encryptData(data, 'secret', 'a.txt');
  assert.deepEqual(await decryptData(truthful, 'secret'), { data, name: 'a.txt' });

  for (const limit of [SEND_ENVELOPE_LIMIT, FIRST_PARTY_ENVELOPE_LIMIT, 1000, 300]) {
    for (const size of [0, 10, limit - 200, limit - PASSWORD_ENVELOPE_OVERHEAD, limit - PASSWORD_ENVELOPE_OVERHEAD + 1]) {
      if (size < 0) continue;
      const sealed = sealedLength(size, limit);
      assert.ok(sealed >= size + PASSWORD_ENVELOPE_OVERHEAD && sealed <= Math.max(limit, size + PASSWORD_ENVELOPE_OVERHEAD), `${limit}/${size}`);
      if (size + PASSWORD_ENVELOPE_OVERHEAD > limit) assert.equal(sealed, size + PASSWORD_ENVELOPE_OVERHEAD);
    }
  }

  const name = 'big.bin';
  const metaLength = utf8(JSON.stringify({ name, size: 0 }));
  const fileSize = SEND_ENVELOPE_LIMIT - PASSWORD_ENVELOPE_OVERHEAD - 5 - metaLength - 4096;
  const fileMeta = utf8(JSON.stringify({ name, size: fileSize }));
  assert.ok(72 + padme(4 + 5 + fileMeta + fileSize) + 16 > SEND_ENVELOPE_LIMIT);
  const big = new Uint8Array(fileSize);
  big[fileSize - 1] = 42;
  const sealedBig = await encryptData(big, 'secret', name);
  assert.ok(sealedBig.length <= SEND_ENVELOPE_LIMIT, String(sealedBig.length));
  const back = await decryptData(sealedBig, 'secret');
  assert.equal(back.data.length, fileSize);
  assert.equal(back.data[fileSize - 1], 42);

  const stego = await encrypt('x'.repeat(500), 'secret', 600);
  assert.ok(stego.length <= 600 && stego.length >= 592);
  assert.equal(await decrypt(stego, 'secret'), 'x'.repeat(500));
  assert.equal((await encrypt('x'.repeat(600), 'secret', 600)).length, 600 + PASSWORD_ENVELOPE_OVERHEAD);
  assert.equal(to14BitChunks(await encrypt('a', 'secret')).length, 55);
});

test('version 3 chat rooms derive once, bind the mode into the key and keep the token independent of it', async () => {
  const a = await roomSecret(PASSWORD, 'room', 'chat');
  assert.equal(a.token, 'e7acad0f4eca76eae286cac0a2884f069ff5201226d1105f563b0b0f3ed8af25');
  assert.equal(a.channel, '3688a677f276b26fc77b7501538ebf45d40c80608ba80d1dc9adf03c485da373');
  assert.equal(a.channel, await accessChannel(a.token));
  for (const [password, room, scope] of [['other-Password-123', 'room', 'chat'], [PASSWORD, 'room2', 'chat'], [PASSWORD, 'room', 'whiteboard']] as const) {
    assert.notEqual((await roomSecret(password, room, scope)).channel, a.channel);
  }

  const live = await roomMessageKey(a.base, 'live');
  const burn = await roomMessageKey(a.base, 'ttl-10');
  const sealed = await encryptMessage(burn, 'hello');
  const again = await roomSecret(PASSWORD, 'room', 'chat');
  assert.equal(await decryptMessage(await roomMessageKey(again.base, 'ttl-10'), sealed), 'hello');
  await assert.rejects(decryptMessage(live, sealed));
  const fromToken = await importRoomKey(Buffer.from(a.token, 'hex').toString('base64url'));
  await assert.rejects(decryptMessage(fromToken, sealed));
  assert.notEqual(hex(await hkdfBytes(a.base, 'encrypt.click/chat/v3/messages:ttl-10')), a.token);
});

test('joiners open only version 3 rooms, refuse version 2 and unversioned settings and keep the mode locked', () => {
  const v3 = { mode: 'live', v: 3 };
  assert.equal(roomLookup(null, null), 'missing');
  assert.equal(roomLookup(v3, null), 'open');
  assert.equal(roomLookup(v3, '3:live'), 'open');
  assert.equal(roomLookup(v3, '3:ttl-60'), 'mismatch');
  assert.equal(roomLookup({ mode: 'ttl-60', v: 2 }, null), 'mismatch');
  assert.equal(roomLookup({ mode: 'live' }, null), 'mismatch');
  assert.equal(configStamp(v3), '3:live');
});

test('whiteboard messages each get their own HKDF subkey, and the old format is dropped', async () => {
  const access = await deriveBoardAccess(PASSWORD, 'room');
  assert.equal(access.token, '06f0778e12d00ff9762cb678421339866b4d43fe7946af421c119d89fc2ac582');
  assert.equal(access.channel, await accessChannel(access.token));
  assert.notEqual(access.channel, (await roomSecret(PASSWORD, 'room', 'chat')).channel);

  const base = await boardMessageBase(await hkdfKey(crypto.getRandomValues(new Uint8Array(32))));
  const one = await sealBoardMessage(base, 'cursor');
  const two = await sealBoardMessage(base, 'cursor');
  const bytes = (payload: string) => new Uint8Array(Buffer.from(payload, 'base64url'));
  assert.equal(bytes(one)[0], 3);
  assert.notDeepEqual(bytes(one).slice(1, 17), bytes(two).slice(1, 17));
  assert.equal(await openBoardMessage(base, one), 'cursor');

  const raw = bytes(one);
  const subkey = await hkdfAesKey(base, 'encrypt.click/whiteboard/v3/msg', raw.slice(1, 17));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(17, 29), additionalData: raw.slice(0, 17) }, subkey, raw.slice(29));
  assert.equal(new TextDecoder().decode(plain), 'cursor');

  for (const offset of [0, 1, 16, 17, 28, 29, raw.length - 1]) {
    const altered = raw.slice();
    altered[offset] ^= 1;
    await assert.rejects(openBoardMessage(base, Buffer.from(altered).toString('base64url')), String(offset));
  }
  await assert.rejects(openBoardMessage(await boardMessageBase(await hkdfKey(new Uint8Array(32))), one));

  const me = await generateSigningIdentity();
  const oldKey = await importRoomKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'));
  const oldFormat = await encryptMessage(oldKey, await signPayload(me, JSON.stringify(stampEnvelope('cursor', { x: 1, y: 1, alias: [1, 2, 3] }, 'c'.repeat(64)))));
  assert.equal(await openEnvelope(base, oldFormat, 'cursor', 'c'.repeat(64)), null);
});

test('signed payloads land on Padmé buckets with a 512-byte floor, and the pad is bounded', async () => {
  const me = await generateSigningIdentity();
  const room = 'a'.repeat(64);
  const alias = [12, 200, 33];
  const samples = [
    { type: 'typing', alias },
    { type: 'verify', challenge: crypto.randomUUID(), alias, clientId: crypto.randomUUID() },
    { type: 'chat-message', id: 'abcdef0123456789', text: 'hi', alias, ttl: 0, createdAt: Date.now() },
  ];
  for (const sample of samples) {
    const signed = await signPayload(me, padPayload(stampPayload(JSON.stringify(sample), room)));
    assert.equal(utf8(signed), PAD_MIN_BYTES);
    assert.equal(validPayload(JSON.parse(signed), room), true);
  }
  for (const text of ['x'.repeat(700), 'ž'.repeat(1500), '🔒'.repeat(3000)]) {
    const signed = await signPayload(me, padPayload(stampPayload(JSON.stringify({ type: 'chat-message', text, alias }), room)));
    const size = utf8(signed);
    assert.ok(size > PAD_MIN_BYTES && size === padme(size), String(size));
  }
  const unsigned = padPayload(stampPayload(JSON.stringify({ type: 'typing' }), room), 0);
  assert.equal(utf8(unsigned), PAD_MIN_BYTES);
  assert.equal(SIGNATURE_BYTES, 148);

  const ok = JSON.parse(stampPayload(JSON.stringify({ type: 'typing' }), room));
  assert.equal(validPayload({ ...ok, _pad: '' }, room), true);
  assert.equal(validPayload({ ...ok, _pad: 5 }, room), false);
  assert.equal(validPayload({ ...ok, _pad: '0'.repeat(PAD_MAX_CHARS + 1) }, room), false);
  assert.equal(validPad(undefined), true);
  const stamped = stampEnvelope('verify', { alias: [1, 2, 3] }, room);
  assert.equal(validEnvelope({ ...stamped, _pad: '000' }, 'verify', room), true);
  assert.equal(validEnvelope({ ...stamped, _pad: ['0'] }, 'verify', room), false);

  const base = await boardMessageBase(await hkdfKey(new Uint8Array(32).fill(1)));
  const sealed = await sealEnvelope(base, me, 'cursor', { x: 1, y: 2, alias: [1, 2, 3] }, room);
  assert.equal(Buffer.from(sealed, 'base64url').length, 1 + 16 + 12 + PAD_MIN_BYTES + 16);
  assert.equal((await openEnvelope(base, sealed, 'cursor', room))?.signer, me.publicKey);
});

test('safety numbers are 60 digits from SHA-512 over the sorted keys, the same on both sides', async () => {
  const alice = (await generateSigningIdentity()).publicKey;
  const bob = (await generateSigningIdentity()).publicKey;
  const ab = await safetyNumber(alice, bob);
  assert.equal(ab, await safetyNumber(bob, alice));
  assert.match(ab, /^\d{5}( \d{5}){11}$/);
  assert.notEqual(ab, await safetyNumber(alice, (await generateSigningIdentity()).publicKey));
  const digest = nodeCrypto.createHash('sha512').update(`encrypt.click:safety-v2:${[alice, bob].sort().join(':')}`).digest();
  const expected = Array.from({ length: 12 }, (_, i) => String(Number(BigInt(`0x${hex(digest.subarray(i * 5, i * 5 + 5))}`) % 100000n)).padStart(5, '0'));
  assert.equal(ab, expected.join(' '));
  assert.match(await keyCode(alice), /^\d{5} \d{5} \d{5} \d{5}$/);
});
