import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, to14BitChunks, from14BitChunks } from '../src/lib/aesGcm';
import { encryptData, decryptData } from '../src/lib/ghost/crypto';
import { accessChannel, safeColor, ReplayWindow } from '../src/lib/roomAccess';
import { parseAllowedFetchUrl } from '../src/lib/ghost/allowedFetch';
import { readLimited } from '../src/lib/httpLimits';
import { issueTurnGrant, verifyTurnGrant } from '../src/lib/turnGrant';
import { stampPayload, validPayload } from '../src/lib/chatProtocol';
import Chat from '../party/chat';
import Whiteboard from '../party/whiteboard';
import { RoomAccess, connectionRequest } from '../party/access';
import { GET as fetchFile } from '../src/pages/api/ghost/fetch';
import { SEND_AUTH_KEY_HEADER } from '../src/lib/nologSend';

test('new text encryption round trips Unicode, randomizes output and authenticates every part', async () => {
  const first = await encrypt('Příliš 🔒', 'secret');
  assert.equal(await decrypt(first, 'secret'), 'Příliš 🔒');
  assert.notDeepEqual(first, await encrypt('Příliš 🔒', 'secret'));
  await assert.rejects(decrypt(first, 'wrong'));
  for (const offset of [0, 8, 24, 36, first.length - 1]) {
    const altered = first.slice(); altered[offset] ^= 1;
    await assert.rejects(decrypt(altered, 'secret'));
  }
});

test('file metadata round trips long and non-ASCII names', async () => {
  for (const name of ['a.txt', 'a'.repeat(240) + '.txt', 'ž'.repeat(300) + '.txt']) {
    const data = new Uint8Array(20000).fill(7);
    assert.deepEqual(await decryptData(await encryptData(data, 'secret', name), 'secret'), { data, name });
  }
});

test('word format preserves both sides of the old 16-bit boundary', () => {
  for (const size of [0, 1, 2, 65534, 65535, 65536, 65537, 200000]) {
    const data = Uint8Array.from({ length: size }, (_, i) => i % 251);
    assert.deepEqual(from14BitChunks(to14BitChunks(data)), data);
  }
  assert.throws(() => from14BitChunks([16384]));
  assert.throws(() => from14BitChunks(to14BitChunks(new Uint8Array(100)).slice(0, 3)));
});

test('URL policy rejects local networks, nonstandard ports, credentials and deceptive hosts', () => {
  for (const u of ['http://upload.nolog.cz/x', 'https://127.0.0.1/', 'https://[::1]/', 'https://upload.nolog.cz:8080/',
    'https://upload.nolog.cz.evil.test/', 'https://evil.test@upload.nolog.cz/', 'file:///etc/passwd', 'https://dl.encrypt.click/file']) assert.equal(parseAllowedFetchUrl(u), null, u);
  assert.ok(parseAllowedFetchUrl('https://upload.nolog.cz/file'));
});

test('bounded reader cancels chunked bodies that exceed the cap', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } });
  await assert.rejects(readLimited(new Response(stream), 10), /large/);
  assert.equal(cancelled, true);
  await assert.rejects(readLimited(new Response('x', { headers: { 'content-length': '100' } }), 10));
});

test('download proxy never serves active upstream content as a document', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<svg onload="alert(1)"/>', { headers: { 'Content-Type': 'image/svg+xml' } });
  try {
    const url = new URL(`https://encrypt.click/api/ghost/fetch?url=${encodeURIComponent('https://upload.nolog.cz/download/0123456789abcdef/')}`);
    const response = await fetchFile({ url, request: new Request(url, { headers: { [SEND_AUTH_KEY_HEADER]: 'A'.repeat(86) } }) } as any);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
    assert.match(response.headers.get('Content-Disposition')!, /attachment/);
    assert.match(response.headers.get('Content-Security-Policy')!, /sandbox/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  } finally { globalThis.fetch = original; }
});

function fakeRoom(name: string) {
  const connections: any[] = [];
  const stored = new Map();
  const alarms: number[] = [];
  const host = { name, env: {}, getConnections: () => connections.values(), storage: {
    get: async (key: string) => stored.get(key), put: async (key: string, value: unknown) => { stored.set(key, value); },
    delete: async (key: string) => stored.delete(key), list: async () => new Map(), deleteAll: async () => stored.clear(),
    setAlarm: async (time: number) => { alarms.length = 0; alarms.push(time); }, deleteAlarm: async () => { alarms.length = 0; },
  } } as any;
  function conn(id: string) {
    const c = { id, state: null as any, messages: [] as any[], closed: 0,
      setState(value: any) { this.state = value; }, send(value: string) { this.messages.push(JSON.parse(value)); }, close(code: number) { this.closed = code; } };
    connections.push(c); return c;
  }
  function drop(c: any) { const i = connections.indexOf(c); if (i >= 0) connections.splice(i, 1); }
  return { host, conn, drop, stored, alarms };
}

for (const Server of [Chat, Whiteboard]) test(`${Server.name}: unauthorized lock, authorized join, and preconnected lock bypass`, async () => {
  const token = 'a'.repeat(64);
  const room = fakeRoom(await accessChannel(token));
  const server = new Server(room.host);
  const bad = room.conn('bad'), good = room.conn('good'), waiting = room.conn('waiting');
  server.onConnect(bad as any); server.onConnect(good as any); server.onConnect(waiting as any);
  await server.onMessage(JSON.stringify({ type: 'lock' }), bad as any);
  await server.onMessage(JSON.stringify({ type: 'join', token, config: { mode: 'live', authMode: 'password', v: 3 } }), good as any);
  assert.equal(good.closed, 0);
  await server.onMessage(JSON.stringify({ type: 'lock' }), good as any);
  assert.ok(good.messages.some(m => m.type === 'locked'));
  await server.onMessage(JSON.stringify({ type: 'join', token }), waiting as any);
  assert.equal(waiting.closed, 4003);
  await server.onMessage(JSON.stringify({ type: 'unlock' }), bad as any);
  assert.equal(good.messages.filter(m => m.type === 'unlocked').length, 0);
  server.onClose(bad as any); server.onClose(waiting as any); server.onClose(good as any);
});

test('chat rooms always keep a cleanup alarm that moves with activity and only deletes an empty room', async () => {
  const token = 'a'.repeat(64);
  const room = fakeRoom(await accessChannel(token));
  const server = new Chat(room.host);
  const first = room.conn('first');
  server.onConnect(first as any);
  await server.onMessage(JSON.stringify({ type: 'join', token, config: { mode: 'live', authMode: 'password', v: 3 } }), first as any);
  assert.equal(room.stored.size, 1);
  assert.equal(room.alarms.length, 1);
  room.drop(first); server.onClose(first as any);
  assert.equal(room.alarms.length, 1);
  const again = room.conn('again');
  server.onConnect(again as any);
  await server.onAlarm();
  assert.equal(room.stored.size, 1);
  assert.equal(room.alarms.length, 1);
  room.drop(again); server.onClose(again as any);
  await server.onAlarm();
  assert.equal(room.stored.size, 0);
});

test('TURN grants reject tampering, missing secret and expired grants', async () => {
  const secret = 's'.repeat(32), room = 'a'.repeat(64);
  const grant = await issueTurnGrant(secret, room);
  assert.equal(await verifyTurnGrant(secret, grant), room);
  assert.equal(await verifyTurnGrant('', grant), null);
  assert.equal(await verifyTurnGrant(secret, grant.replace(/^a/, 'b')), null);
  const original = Date.now;
  Date.now = () => original() + 61000;
  try { assert.equal(await verifyTurnGrant(secret, grant), null); } finally { Date.now = original; }
});

test('client-selected duplicate connection IDs do not inherit authorization', async () => {
  const token = 'a'.repeat(64);
  const room = fakeRoom(await accessChannel(token));
  const access = new RoomAccess(room.host);
  const legitimate = room.conn('same-id'), impostor = room.conn('same-id');
  assert.equal(await access.join(legitimate as any, token, () => false), true);
  assert.equal(access.has(impostor as any), false);
  access.remove(impostor as any);
  assert.equal(access.has(legitimate as any), true);
  const request = new Request('https://relay.test/parties/main/room?_pk=chosen');
  const first = connectionRequest(request), second = connectionRequest(request);
  assert.notEqual(new URL(first.url).searchParams.get('_pk'), 'chosen');
  assert.notEqual(first.url, second.url);
});

test('CSS declaration injection and repeated ciphertext are rejected', () => {
  assert.equal(safeColor('hsl(40, 65%, 55%)'), 'hsl(40, 65%, 55%)');
  assert.notEqual(safeColor('red;background:url(https://attacker.test)'), 'red;background:url(https://attacker.test)');
  const replay = new ReplayWindow(); assert.equal(replay.accept('ciphertext'), true); assert.equal(replay.accept('ciphertext'), false);
});

test('authenticated chat context rejects cross-room and stale control messages', () => {
  const message = JSON.parse(stampPayload(JSON.stringify({ type: 'verify', challenge: 'fresh' }), 'room'));
  assert.equal(validPayload(message, 'room'), true);
  assert.equal(validPayload(message, 'different'), false);
  assert.equal(validPayload(message, 'room', true), false);
  assert.equal(validPayload({ ...message, _sentAt: Date.now() - 61000 }, 'room'), false);
  assert.equal(validPayload({ ...message, _sentAt: Date.now() + 60000 }, 'room'), false);
  const chat = JSON.parse(stampPayload(JSON.stringify({ type: 'chat-message', text: 'hi' }), 'room'));
  assert.equal(validPayload({ ...chat, _sentAt: Date.now() - 2 * 3600_000 }, 'room'), true);
  assert.equal(validPayload({ ...chat, _sentAt: Date.now() - 25 * 3600_000 }, 'room'), false);
  assert.equal(validPayload({ ...chat, _sentAt: Date.now() - 25 * 3600_000 }, 'room', true), true);
  const named = JSON.parse(stampPayload(JSON.stringify({ type: 'chat-message', text: 'hi', nick: 'Marek' }), 'room'));
  assert.equal(validPayload(named, 'room'), true);
  assert.equal(validPayload({ ...named, nick: 'Ma rek' }, 'room'), false);
  assert.equal(validPayload({ ...named, nick: 'a'.repeat(25) }, 'room'), false);
  assert.equal(validPayload({ ...named, nick: 7 }, 'room'), false);
  const rename = JSON.parse(stampPayload(JSON.stringify({ type: 'rename', nick: 'Marek', prev: '1-2-3' }), 'room'));
  assert.equal(validPayload(rename, 'room'), true);
  assert.equal(validPayload({ ...rename, prev: 'x'.repeat(65) }, 'room'), false);
  assert.equal(validPayload(rename, 'room', true), false);
});
