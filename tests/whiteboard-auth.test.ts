import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSigningIdentity, signPayload } from '../src/lib/chatCrypto';
import { hkdfKey } from '../src/lib/kdf';
import type { TrustTable } from '../src/lib/chatIdentity';
import {
  stampEnvelope, validEnvelope, sealEnvelope, openEnvelope, signBoardItem, verifyBoardItem,
  ConnectionKeys, BoardTrust, lookalike, LIVE_MAX_AGE_MS, FUTURE_SKEW_MS,
} from '../src/lib/whiteboardProtocol';
import { validBoardChatItem } from '../src/lib/whiteboardRecords';
import { DOC_PART_BYTES } from '../src/lib/whiteboardSync';
import { bytesToB64, b64ToBytes, boardMessageBase, sealBoardMessage } from '../src/lib/whiteboardCrypto';
import { roomPasswordOk } from '../src/lib/chatRoomSettings';

const ROOM = 'channel-a';
const boardKey = async () => boardMessageBase(await hkdfKey(crypto.getRandomValues(new Uint8Array(32))));
const alias = [1, 2, 3];

test('stamps bind room, kind, time and a unique id', () => {
  const now = 1_760_000_000_000;
  const a = stampEnvelope('cursor', { x: 1, y: 2, alias }, ROOM, now);
  const b = stampEnvelope('cursor', { x: 1, y: 2, alias }, ROOM, now);
  assert.equal(a._kind, 'cursor');
  assert.equal(a._room, ROOM);
  assert.equal(a._sentAt, now);
  assert.notEqual(a._id, b._id);
  assert.equal(validEnvelope(a, 'cursor', ROOM, now), true);
  assert.equal(validEnvelope(stampEnvelope('cursor', { x: 1, alias, _kind: 'doc', _room: 'x' }, ROOM, now), 'cursor', ROOM, now), true);
});

test('stamp validation rejects other rooms, kinds, stale, future and malformed payloads', () => {
  const now = 1_760_000_000_000;
  const ok = stampEnvelope('verify', { alias }, ROOM, now);
  assert.equal(validEnvelope(ok, 'verify', 'channel-b', now), false);
  assert.equal(validEnvelope(ok, 'verify-ack', ROOM, now), false);
  assert.equal(validEnvelope(ok, 'unknown', ROOM, now), false);
  assert.equal(validEnvelope(ok, 'verify', ROOM, now + LIVE_MAX_AGE_MS + 1), false);
  assert.equal(validEnvelope(ok, 'verify', ROOM, now + LIVE_MAX_AGE_MS), true);
  assert.equal(validEnvelope(ok, 'verify', ROOM, now - FUTURE_SKEW_MS - 1), false);
  assert.equal(validEnvelope(ok, 'verify', ROOM, now - FUTURE_SKEW_MS), true);
  for (const field of ['_kind', '_room', '_sentAt', '_id']) {
    const missing = { ...ok };
    delete missing[field];
    assert.equal(validEnvelope(missing, 'verify', ROOM, now), false, field);
  }
  assert.equal(validEnvelope({ ...ok, _id: 'x'.repeat(65) }, 'verify', ROOM, now), false);
  assert.equal(validEnvelope({ ...ok, _sentAt: Infinity }, 'verify', ROOM, now), false);
  assert.equal(validEnvelope({ ...ok, alias: [99, 2, 3] }, 'verify', ROOM, now), false);
  assert.equal(validEnvelope(stampEnvelope('doc', {}, ROOM, now), 'doc', ROOM, now), false);
  assert.equal(validEnvelope(stampEnvelope('doc-part', { data: 'AAAA' }, ROOM, now), 'doc-part', ROOM, now), true);
  assert.equal(validEnvelope(stampEnvelope('chat', {}, ROOM, now), 'chat', ROOM, now), false);
  assert.equal(validEnvelope(null, 'verify', ROOM, now), false);
  assert.equal(validEnvelope([ok], 'verify', ROOM, now), false);
  assert.equal(validEnvelope(ok, 'verify', '', now), false);
});

test('sealed envelopes open only with the right key, kind and room and a valid signature', async () => {
  const key = await boardKey();
  const other = await boardKey();
  const me = await generateSigningIdentity();
  const sealed = await sealEnvelope(key, me, 'cursor', { x: 4, y: 5, alias }, ROOM);

  const opened = await openEnvelope(key, sealed, 'cursor', ROOM);
  assert.equal(opened?.signer, me.publicKey);
  assert.equal(opened?.body.x, 4);
  assert.equal(await openEnvelope(other, sealed, 'cursor', ROOM), null);
  assert.equal(await openEnvelope(key, sealed, 'verify', ROOM), null);
  assert.equal(await openEnvelope(key, sealed, 'cursor', 'channel-b'), null);
  assert.equal(await openEnvelope(key, sealed, 'cursor', ROOM, Date.now() + LIVE_MAX_AGE_MS + 1000), null);
  assert.equal(await openEnvelope(key, 'not-a-payload', 'cursor', ROOM), null);

  const unsigned = await sealBoardMessage(key, JSON.stringify(stampEnvelope('cursor', { x: 1, y: 1, alias }, ROOM)));
  assert.equal(await openEnvelope(key, unsigned, 'cursor', ROOM), null);

  const signed = JSON.parse(await signPayload(me, JSON.stringify(stampEnvelope('cursor', { x: 1, y: 1, alias }, ROOM))));
  const tampered = await sealBoardMessage(key, JSON.stringify({ ...signed, alias: [4, 5, 6] }));
  assert.equal(await openEnvelope(key, tampered, 'cursor', ROOM), null);
});

test('board chat items carry their author signature bound to the room', async () => {
  const me = await generateSigningIdentity();
  const item = await signBoardItem(me, { id: 'abc123', text: 'hello', alias: [1, 2, 3] as [number, number, number], at: 1_760_000_000_000 }, ROOM);
  assert.equal(validBoardChatItem(item), true);
  assert.equal('_room' in item, false);
  assert.equal(await verifyBoardItem(item, ROOM), me.publicKey);
  assert.equal(await verifyBoardItem(item, 'channel-b'), null);
  assert.equal(await verifyBoardItem({ ...item, text: 'changed' }, ROOM), null);
  const mallory = await generateSigningIdentity();
  assert.equal(await verifyBoardItem({ ...item, _pk: mallory.publicKey }, ROOM), null);
  assert.equal(await verifyBoardItem(null, ROOM), null);
});

test('a relay connection id stays bound to the first key that signs from it', () => {
  const keys = new ConnectionKeys();
  assert.equal(keys.bind('conn-1', 'key-a'), true);
  assert.equal(keys.bind('conn-1', 'key-a'), true);
  assert.equal(keys.bind('conn-1', 'key-b'), false);
  assert.equal(keys.bind('conn-2', 'key-b'), true);
  assert.equal(keys.get('conn-1'), 'key-a');
  assert.equal(keys.bind('', 'key-a'), false);
  assert.equal(keys.bind(undefined, 'key-a'), false);
});

test('trust is first come per label, flags changed keys and lookalike names, and can be accepted', () => {
  const table: TrustTable = {};
  let saves = 0;
  let changes = 0;
  const trust = new BoardTrust(table, { pk: 'me', key: '0-0-0', name: 'Calm Owl' }, () => { saves++; }, () => { changes++; });
  assert.deepEqual(table['0-0-0'], ['me']);
  assert.equal(trust.note('me', '0-0-0', 'Calm Owl'), true);

  assert.equal(trust.note('alice', '1-2-3', 'Swift Fox'), true);
  assert.deepEqual(table['1-2-3'], ['alice']);
  assert.equal(trust.note('mallory', '1-2-3', 'Swift Fox'), false);
  assert.equal(trust.note('mallory2', '1-2-200', 'Swift  fox'), false);
  assert.equal(table['1-2-200'], undefined);
  assert.equal(trust.note('mallory3', '0-0-90', 'Calm 0wl'), false);
  assert.equal(trust.note('bob', '4-5-6', 'Bold Bear'), true);
  assert.equal(trust.members.get('mallory')?.trusted, false);

  assert.equal(trust.accept('mallory'), true);
  assert.equal(trust.note('mallory', '1-2-3', 'Swift Fox'), true);
  assert.deepEqual(table['1-2-3'], ['alice', 'mallory']);
  assert.equal(trust.accept('nobody'), false);
  assert.ok(saves >= 4);
  assert.ok(changes >= 5);

  const again = new BoardTrust(table, { pk: 'me', key: '0-0-0', name: 'Calm Owl' });
  assert.equal(again.note('alice', '1-2-3', 'Swift Fox'), true);
  assert.equal(again.note('eve', '1-2-3', 'Swift Fox'), false);
});

test('lookalike folds case, accents, spacing and common character swaps', () => {
  assert.equal(lookalike('Rychlá Liška'), lookalike('rychla  liska'));
  assert.equal(lookalike('Calm Owl'), lookalike('ca1m 0wl'));
  assert.equal(lookalike('Modern'), lookalike('Modem'));
  assert.notEqual(lookalike('Swift Fox'), lookalike('Bold Bear'));
});

test('a full signed doc part still fits under the relay payload cap', async () => {
  const key = await boardKey();
  const me = await generateSigningIdentity();
  const part = new Uint8Array(DOC_PART_BYTES + 13).map((_, i) => (i * 7) % 256);
  const sealed = await sealEnvelope(key, me, 'doc-part', { data: bytesToB64(part) }, 'c'.repeat(64));
  assert.ok(sealed.length < 720000, String(sealed.length));
  const opened = await openEnvelope(key, sealed, 'doc-part', 'c'.repeat(64));
  assert.deepEqual(b64ToBytes(opened!.body.data as string), part);
});

test('boards opened from a chat invite get a password that may create them', () => {
  // Mirrors genAutoPassword in ChatRoom.svelte, which draws again until the policy passes.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const draw = () => {
    const bytes = crypto.getRandomValues(new Uint32Array(20));
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
    return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-');
  };
  let firstTry = 0;
  for (let n = 0; n < 500; n++) {
    const room = `chat-${n.toString(16).padStart(32, '0')}`;
    let password = draw();
    if (roomPasswordOk(password, room)) firstTry++;
    for (let tries = 0; !roomPasswordOk(password, room) && tries < 20; tries++) password = draw();
    assert.equal(roomPasswordOk(password, room), true, password);
  }
  assert.ok(firstTry >= 490, `only ${firstTry} of 500 passed on the first draw`);
  assert.equal(roomPasswordOk('hunter2', 'board'), false);
});
