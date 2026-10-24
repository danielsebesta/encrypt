import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_TAG_BYTES, FRAME_TRAILER_BYTES, FrameKeyring, MediaKeySchedule, createCallKeyPair, createMediaKey, decryptFrame,
  deriveWrapKey, encryptFrame, frameIv, framePrefixLength, importFrameKey, isCallPublicKey, mediaKeyContext,
  readFrameHeader, safeVideoCodecs, unwrapMediaKey, wrapMediaKey,
} from '../src/lib/callCrypto';

const frame = (length: number, seed = 1) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff);

async function seal(keyId = 7, data = frame(200), prefix = 3) {
  const key = await importFrameKey(createMediaKey().raw, keyId);
  return { key, data, sealed: await encryptFrame(key, data, prefix) };
}

test('frames round trip with the codec prefix left readable and a trailer carrying counter, prefix length and key id', async () => {
  const { key, data, sealed } = await seal(7, frame(200), 10);
  assert.equal(sealed.length, data.length + FRAME_TAG_BYTES + FRAME_TRAILER_BYTES);
  assert.deepEqual(sealed.subarray(0, 10), data.subarray(0, 10));
  assert.notDeepEqual(sealed.subarray(10, 200), data.subarray(10));
  const header = readFrameHeader(sealed);
  assert.deepEqual(header, { keyId: 7, counter: 0n, prefixLength: 10 });
  assert.deepEqual(await decryptFrame(sealed, header!, key), data);
  for (const length of [0, 1, 2, 3, 11]) {
    const small = frame(length);
    const out = await encryptFrame(key, small, 3);
    const parsed = readFrameHeader(out)!;
    assert.equal(parsed.prefixLength, Math.min(3, length));
    assert.deepEqual(await decryptFrame(out, parsed, key), small);
  }
});

test('codec prefixes follow the packetizers: VP8 key 10, delta 3, Opus 1, clamped to the frame', () => {
  assert.equal(framePrefixLength('video', 'key', 500), 10);
  assert.equal(framePrefixLength('video', 'delta', 500), 3);
  assert.equal(framePrefixLength('audio', undefined, 80), 1);
  assert.equal(framePrefixLength('video', 'key', 4), 4);
  assert.equal(framePrefixLength('video', 'empty', 0), 0);
  assert.equal(framePrefixLength('audio', undefined, 0), 0);
});

test('any change to the clear prefix, ciphertext, tag or trailer makes the frame undecryptable', async () => {
  const { key, sealed } = await seal(9, frame(120), 10);
  const offsets = [0, 5, 9, 10, 60, sealed.length - FRAME_TRAILER_BYTES - 1, sealed.length - FRAME_TRAILER_BYTES, sealed.length - 3, sealed.length - 2];
  for (const offset of offsets) {
    const altered = sealed.slice();
    altered[offset] ^= 1;
    const header = readFrameHeader(altered);
    assert.equal(header ? await decryptFrame(altered, header, key) : null, null, `offset ${offset}`);
  }
  assert.equal(readFrameHeader(sealed.subarray(0, FRAME_TAG_BYTES + FRAME_TRAILER_BYTES - 1)), null);
  const bogusPrefix = sealed.slice();
  bogusPrefix[bogusPrefix.length - 2] = 200;
  assert.equal(readFrameHeader(bogusPrefix), null);
});

test('a frame only opens with the key and key id it was sealed with', async () => {
  const { sealed } = await seal(3);
  const header = readFrameHeader(sealed)!;
  const sameIdOtherKey = await importFrameKey(createMediaKey().raw, 3);
  assert.equal(await decryptFrame(sealed, header, sameIdOtherKey), null);
  const raw = createMediaKey().raw;
  const a = await importFrameKey(raw, 4);
  const b = await importFrameKey(raw, 5);
  const out = await encryptFrame(a, frame(50), 3);
  assert.equal(await decryptFrame(out, readFrameHeader(out)!, b), null);
  const relabelled = out.slice();
  relabelled[relabelled.length - 1] = 5;
  assert.equal(await decryptFrame(relabelled, readFrameHeader(relabelled)!, b), null);
});

test('every frame under one key gets a fresh counter and a distinct IV', async () => {
  const key = await importFrameKey(createMediaKey().raw, 1);
  const ivs = new Set<string>();
  const counters: bigint[] = [];
  const sealed = await Promise.all(Array.from({ length: 300 }, (_, i) => encryptFrame(key, frame(40, i), 1)));
  for (const out of sealed) {
    const header = readFrameHeader(out)!;
    counters.push(header.counter);
    ivs.add(Buffer.from(frameIv(key.salt, header.counter)).toString('hex'));
  }
  assert.equal(new Set(counters).size, 300);
  assert.equal(ivs.size, 300);
  assert.equal(key.counter, 300n);
  const iv = frameIv(key.salt, 0x0102030405060708n);
  assert.deepEqual(iv.subarray(0, 4), key.salt.subarray(0, 4));
  assert.equal(Buffer.from(iv.subarray(4)).readBigUInt64BE() ^ Buffer.from(key.salt.subarray(4)).readBigUInt64BE(), 0x0102030405060708n);
  assert.throws(() => frameIv(key.salt, 1n << 64n));
  const other = await importFrameKey(createMediaKey().raw, 1);
  assert.notDeepEqual(other.salt, key.salt);
});

test('the receive keyring keeps a superseded key only for the grace period and ignores late older keys as current', async () => {
  const ring = new FrameKeyring(1000, 3);
  const k1 = await importFrameKey(createMediaKey().raw, 255);
  const k2 = await importFrameKey(createMediaKey().raw, 0);
  const k3 = await importFrameKey(createMediaKey().raw, 1);
  ring.set('a', k1, 0);
  assert.equal(ring.get('a', 255, 10_000), k1);
  ring.set('a', k2, 100);
  assert.equal(ring.get('a', 255, 1099), k1);
  assert.equal(ring.get('a', 0, 50_000), k2);
  assert.equal(ring.get('a', 255, 1100), undefined);
  ring.set('a', k3, 2000);
  ring.set('a', k2, 2100);
  assert.equal(ring.get('a', 1, 90_000), k3);
  assert.equal(ring.get('a', 0, 3099), k2);
  assert.equal(ring.get('a', 0, 3101), undefined);
  assert.equal(ring.get('b', 1), undefined);
  ring.set('b', k1, 0);
  ring.drop('a');
  assert.equal(ring.get('a', 1, 2000), undefined);
  assert.equal(ring.get('b', 255, 0), k1);
  for (let id = 10; id < 20; id++) ring.set('b', await importFrameKey(createMediaKey().raw, id), 0);
  assert.equal(ring.get('b', 19, 0)?.id, 19);
  assert.equal(ring.get('b', 10, 0), undefined);
  ring.clear();
  assert.equal(ring.get('b', 19, 0), undefined);
});

test('the sender key schedule activates the first key at once, delays rotations and wipes superseded material', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const activated: number[] = [];
    const schedule = new MediaKeySchedule((key) => activated.push(key.id), 2000);
    const first = schedule.start();
    assert.deepEqual(activated, [first.id]);
    const firstRaw = first.raw;
    const second = schedule.rotate();
    assert.equal(second.id, (first.id + 1) & 0xff);
    assert.ok(firstRaw.every((byte) => byte === 0));
    assert.equal(schedule.latest, second);
    mock.timers.tick(1999);
    assert.deepEqual(activated, [first.id]);
    const third = schedule.rotate();
    mock.timers.tick(1999);
    assert.deepEqual(activated, [first.id]);
    mock.timers.tick(1);
    assert.deepEqual(activated, [first.id, third.id]);
    assert.notDeepEqual(third.raw, second.raw);
    schedule.rotate();
    schedule.wipe();
    mock.timers.tick(5000);
    assert.deepEqual(activated, [first.id, third.id]);
    assert.equal(schedule.latest, null);
    assert.equal(createMediaKey({ id: 255, raw: new Uint8Array(32) }).id, 0);
  } finally {
    mock.timers.reset();
  }
});

test('media keys are wrapped per recipient and bound to sender, recipient and key id', async () => {
  const alice = await createCallKeyPair();
  const bob = await createCallKeyPair();
  const eve = await createCallKeyPair();
  assert.ok(isCallPublicKey(alice.publicKey));
  assert.equal(isCallPublicKey('A'.repeat(87)), false);
  assert.equal(isCallPublicKey(alice.publicKey.slice(1)), false);
  const key = createMediaKey();
  const context = mediaKeyContext('call:room', 'alice', 'bob', key.id);
  const wrapped = await wrapMediaKey(await deriveWrapKey(alice, bob.publicKey), key.raw, context);
  assert.match(wrapped, /^[A-Za-z0-9_-]{80}$/);
  assert.deepEqual(await unwrapMediaKey(await deriveWrapKey(bob, alice.publicKey), wrapped, context), key.raw);
  assert.equal(await unwrapMediaKey(await deriveWrapKey(eve, alice.publicKey), wrapped, context), null);
  assert.equal(await unwrapMediaKey(await deriveWrapKey(bob, alice.publicKey), wrapped, mediaKeyContext('call:room', 'alice', 'carol', key.id)), null);
  assert.equal(await unwrapMediaKey(await deriveWrapKey(bob, alice.publicKey), wrapped, mediaKeyContext('call:room', 'alice', 'bob', (key.id + 1) & 0xff)), null);
  assert.equal(await unwrapMediaKey(await deriveWrapKey(bob, alice.publicKey), 'x'.repeat(80), context), null);
  assert.equal(await unwrapMediaKey(await deriveWrapKey(bob, alice.publicKey), 42, context), null);
  await assert.rejects(deriveWrapKey(alice, alice.publicKey));
  await assert.rejects(deriveWrapKey(alice, 'not a key'));
});

test('video is limited to VP8 then VP9, keeping repair streams, or left alone when neither exists', () => {
  const codecs = [
    { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f' },
    { mimeType: 'video/VP9', sdpFmtpLine: 'profile-id=0' },
    { mimeType: 'video/AV1' },
    { mimeType: 'video/rtx' },
    { mimeType: 'video/VP8' },
    { mimeType: 'video/red' },
    { mimeType: 'video/ulpfec' },
  ];
  assert.deepEqual(safeVideoCodecs(codecs).map((codec) => codec.mimeType), ['video/VP8', 'video/VP9', 'video/rtx', 'video/red', 'video/ulpfec']);
  assert.deepEqual(safeVideoCodecs([{ mimeType: 'video/H264' }, { mimeType: 'video/rtx' }]), []);
});
