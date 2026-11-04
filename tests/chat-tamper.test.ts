import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSigningIdentity, signPayload, verifyPayload, encryptMessage, decryptMessage,
  roomMessageKey, sealLocal, openLocal, importRoomKey, arrayToB64url, b64urlToArray,
} from '../src/lib/chatCrypto';
import { validPayload, stampPayload } from '../src/lib/chatProtocol';
import { ReplayWindow } from '../src/lib/roomAccess';
import { hkdfKey } from '../src/lib/kdf';

const roomKey = () => importRoomKey(arrayToB64url(crypto.getRandomValues(new Uint8Array(32))));

function flipChar(value: string, index: number): string {
  const chars = value.split('');
  chars[index] = chars[index] === 'A' ? 'B' : 'A';
  return chars.join('');
}

test('AES-GCM: a single flipped bit anywhere in the wire payload refuses to open', async () => {
  const key = await roomKey();
  const payload = await encryptMessage(key, JSON.stringify({ type: 'chat-message', text: 'tajná zpráva' }));
  const mutations = [
    flipChar(payload, 0),                      // IV
    flipChar(payload, 16),                     // ciphertext
    flipChar(payload, payload.length - 3),     // auth tag
    payload.slice(0, -6),                      // truncation
    payload + 'AA',                            // extension
  ];
  for (const bad of mutations) {
    await assert.rejects(decryptMessage(key, bad));
  }
  // Decrypting under a different room key fails identically — never a partial read.
  await assert.rejects(decryptMessage(await roomKey(), payload));
});

test('a valid payload decrypts atomically to the exact plaintext', async () => {
  const key = await roomKey();
  const text = 'emoji 🔐 and diacritics ěščřžýáíé';
  assert.equal(await decryptMessage(key, await encryptMessage(key, text)), text);
});

test('Ed25519: forged or mismatched signatures are dropped', async () => {
  const me = await generateSigningIdentity();
  const mallory = await generateSigningIdentity();
  const signed = JSON.parse(await signPayload(me, stampPayload(JSON.stringify({ type: 'chat-message', text: 'hi' }), 'room-a')));

  assert.equal(await verifyPayload(signed), me.publicKey);

  const forgedSig = { ...signed, _sig: flipChar(signed._sig, 10) };
  assert.equal(await verifyPayload(forgedSig), null);
  const alteredText = { ...signed, text: 'changed' };
  assert.equal(await verifyPayload(alteredText), null);
  const swappedPk = { ...signed, _pk: mallory.publicKey };
  assert.equal(await verifyPayload(swappedPk), null);
  const swappedRoom = { ...signed, _room: 'room-b' };
  assert.equal(await verifyPayload(swappedRoom), null);
  const missingSig = { ...signed };
  delete missingSig._sig;
  assert.equal(await verifyPayload(missingSig), null);
  assert.equal(await verifyPayload({ ...signed, _sig: 'not-base64!' }), null);
});

test('cross-room isolation: replayed traffic from room A dies at every layer in room B', async () => {
  const me = await generateSigningIdentity();
  const keyA = await roomKey();
  const keyB = await roomKey();

  // Layer 1: room A ciphertext refuses to open under room B's key.
  const wire = await encryptMessage(keyA, await signPayload(me, stampPayload(JSON.stringify({ type: 'chat-message', text: 'secret' }), 'room-a')));
  await assert.rejects(decryptMessage(keyB, wire));

  // Layer 2: even if it decoded, the signed _room is validated.
  const inner = JSON.parse(await signPayload(me, stampPayload(JSON.stringify({ type: 'chat-message', text: 'secret' }), 'room-a')));
  assert.equal(validPayload(inner, 'room-b'), false);
  // And editing _room breaks the signature (verified above).

  // Layer 3: channel binding — room keys derive from name+scope salt (roomAccess),
  // so cross-room wire replay cannot reach this code path at all.
});

test('replay window: duplicates rejected, eviction keeps the window bounded', () => {
  const replay = new ReplayWindow(4);
  assert.equal(replay.accept('m1'), true);
  assert.equal(replay.accept('m1'), false);
  assert.equal(replay.accept('m2'), true);
  for (const id of ['m3', 'm4', 'm5']) replay.accept(id);
  assert.equal(replay.accept('m1'), true); // evicted, accepts again — by then it is far past its age limit
  assert.equal(replay.accept('m3'), false); // still inside the window
});

test('timestamps: future and stale payloads are refused', () => {
  const live = JSON.parse(stampPayload(JSON.stringify({ type: 'typing', nick: 'a', alias: [0, 0, 0] }), 'room'));
  assert.equal(validPayload(live, 'room'), true);
  assert.equal(validPayload({ ...live, _sentAt: Date.now() - 61_000 }, 'room'), false);
  assert.equal(validPayload({ ...live, _sentAt: Date.now() + 31_000 }, 'room'), false);

  const content = JSON.parse(stampPayload(JSON.stringify({ type: 'chat-message', text: 'x' }), 'room'));
  assert.equal(validPayload({ ...content, _sentAt: Date.now() - 24 * 60 * 60 * 1000 - 1 }, 'room'), false);
  assert.equal(validPayload({ ...content, _id: undefined }, 'room'), false);
  assert.equal(validPayload({ ...content, _room: 42 }, 'room'), false);
});

test('local history: sealed plaintext opens only under its own key and context id', async () => {
  const key = await roomKey();
  const sealed = await sealLocal(key, 'msg-1', 'stored text');
  assert.equal(await openLocal(key, 'msg-1', sealed), 'stored text');
  assert.equal(await openLocal(key, 'msg-2', sealed), null);        // wrong context id (AAD)
  assert.equal(await openLocal(await roomKey(), 'msg-1', sealed), null); // wrong key
  assert.equal(await openLocal(key, 'msg-1', flipChar(sealed, 20)), null); // bit-flip
  assert.equal(await openLocal(key, 'msg-1', 'garbage'), null);
});

test('message keys bind the room mode: a downgraded mode derives a key that opens nothing', async () => {
  const base = await hkdfKey(crypto.getRandomValues(new Uint8Array(32)));
  const live = await roomMessageKey(base, 'live');
  const ttl = await roomMessageKey(base, 'ttl-3600');
  const payload = await encryptMessage(live, 'mode-bound');
  assert.equal(await decryptMessage(live, payload), 'mode-bound');
  await assert.rejects(decryptMessage(ttl, payload));
});
