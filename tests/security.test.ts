import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, to14BitChunks, from14BitChunks } from '../src/lib/aesGcm';
import { encryptData, decryptData } from '../src/lib/ghost/crypto';
import { passwordKey } from '../src/lib/passwordEnvelope';
import { roomCredentials, accessChannel, safeColor, ReplayWindow } from '../src/lib/roomAccess';
import { parseAllowedFetchUrl, fetchAllowedUrl } from '../src/lib/ghost/allowedFetch';
import { readLimited, mapConcurrent } from '../src/lib/httpLimits';
import { issueTurnGrant, verifyTurnGrant } from '../src/lib/turnGrant';
import { stampPayload, validPayload } from '../src/lib/chatProtocol';
import { archiveLegacyHistory, migrateRoomHistory } from '../src/lib/chatHistory';
import Chat from '../party/chat';
import Whiteboard from '../party/whiteboard';
import { RoomAccess, connectionRequest } from '../party/access';
import { POST as verifyUrls } from '../src/pages/api/ghost/verify';
import { GET as fetchFile } from '../src/pages/api/ghost/fetch';

async function legacySeal(payload: Uint8Array) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey('secret', salt, 100000);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload as BufferSource));
  return new Uint8Array([...salt, ...iv, ...ct]);
}

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

test('legacy text and file ciphertext remain readable, including metadata overflow recovery', async () => {
  assert.equal(await decrypt(await legacySeal(new TextEncoder().encode('old text')), 'secret'), 'old text');
  for (const name of ['a.txt', 'a'.repeat(240) + '.txt', 'ž'.repeat(300) + '.txt']) {
    const data = new Uint8Array(20000).fill(7);
    const meta = new TextEncoder().encode(JSON.stringify({ name, size: data.length }));
    const payload = new Uint8Array([meta.length, ...meta, ...data]);
    const result = await decryptData(await legacySeal(payload), 'secret');
    assert.equal(result.name, name); assert.deepEqual(result.data, data);
    const modern = await decryptData(await encryptData(data, 'secret', name), 'secret');
    assert.deepEqual(modern, result);
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

test('room capabilities are secret, separated by purpose and room, and do not expose encryption material', async () => {
  const a = await roomCredentials('password', 'room', 'chat');
  assert.equal(a.channel, await accessChannel(a.token));
  assert.notEqual(a.token, a.channel);
  assert.notEqual(a.channel, (await roomCredentials('other', 'room', 'chat')).channel);
  assert.notEqual(a.channel, (await roomCredentials('password', 'room', 'whiteboard')).channel);
  assert.notEqual(a.channel, (await roomCredentials('password', 'another', 'chat')).channel);
});

test('URL policy rejects local networks, nonstandard ports, credentials and deceptive hosts', () => {
  for (const u of ['http://qu.ax/x', 'https://127.0.0.1/', 'https://[::1]/', 'https://qu.ax:8080/',
    'https://qu.ax.evil.test/', 'https://evil.test@qu.ax/', 'file:///etc/passwd']) assert.equal(parseAllowedFetchUrl(u), null, u);
  assert.ok(parseAllowedFetchUrl('https://qu.ax/file'));
});

test('redirects are revalidated before any request to the next target', async () => {
  const original = globalThis.fetch; const targets: string[] = [];
  globalThis.fetch = async (url) => { targets.push(String(url)); return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private' } }); };
  try { await assert.rejects(fetchAllowedUrl(new URL('https://qu.ax/file'), {})); assert.equal(targets.length, 1); }
  finally { globalThis.fetch = original; }
});

test('bounded reader cancels chunked bodies that exceed the cap', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } });
  await assert.rejects(readLimited(new Response(stream), 10), /large/);
  assert.equal(cancelled, true);
  await assert.rejects(readLimited(new Response('x', { headers: { 'content-length': '100' } }), 10));
});

test('outbound concurrency is bounded while result order stays stable', async () => {
  let active = 0, peak = 0;
  const results = await mapConcurrent([1, 2, 3, 4, 5], 2, async n => {
    active++; peak = Math.max(active, peak); await new Promise(r => setTimeout(r, 2)); active--; return n * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10]); assert.equal(peak, 2);
});

test('verify endpoint refuses oversized, malformed and forbidden target lists without outbound I/O', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected outbound request'); };
  try {
    for (const body of [null, { urls: 'x' }, { urls: ['https://127.0.0.1'] }, { urls: Array(9).fill('https://qu.ax/x') }]) {
      const response = await verifyUrls({ request: new Request('https://encrypt.click/api/ghost/verify', { method: 'POST', body: JSON.stringify(body) }) } as any);
      assert.equal(response.status, 400);
    }
  } finally { globalThis.fetch = original; }
});

test('download proxy never serves active upstream content as a document', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<svg onload="alert(1)"/>', { headers: { 'Content-Type': 'image/svg+xml' } });
  try {
    const url = new URL('https://encrypt.click/api/ghost/fetch?url=https%3A%2F%2Fqu.ax%2Fx');
    const response = await fetchFile({ url, request: new Request(url) } as any);
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
    setAlarm: async (time: number) => { alarms.push(time); }, deleteAlarm: async () => { alarms.length = 0; },
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
  await server.onMessage(JSON.stringify({ type: 'join', token, config: { mode: 'live', authMode: 'password' } }), good as any);
  assert.equal(good.closed, 0);
  await server.onMessage(JSON.stringify({ type: 'lock' }), good as any);
  assert.ok(good.messages.some(m => m.type === 'locked'));
  await server.onMessage(JSON.stringify({ type: 'join', token }), waiting as any);
  assert.equal(waiting.closed, 4003);
  await server.onMessage(JSON.stringify({ type: 'unlock' }), bad as any);
  assert.equal(good.messages.filter(m => m.type === 'unlocked').length, 0);
  server.onClose(bad as any); server.onClose(waiting as any); server.onClose(good as any);
});

test('empty chat rooms schedule their own storage cleanup and cancel it on return', async () => {
  const token = 'a'.repeat(64);
  const room = fakeRoom(await accessChannel(token));
  const server = new Chat(room.host);
  const first = room.conn('first');
  server.onConnect(first as any);
  await server.onMessage(JSON.stringify({ type: 'join', token, config: { mode: 'live', authMode: 'password' } }), first as any);
  assert.equal(room.stored.size, 1);
  room.drop(first); server.onClose(first as any);
  assert.equal(room.alarms.length, 1);
  const again = room.conn('again');
  server.onConnect(again as any);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(room.alarms.length, 0);
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
});

test('legacy history migration removes fast verifiers and preserves undecryptable ciphertext', async () => {
  const entries = new Map<string, string>();
  const storage = { clear: () => entries.clear(), get length() { return entries.size; }, key: (i: number) => [...entries.keys()][i],
    getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) } as Storage;
  storage.setItem('encrypt.click:chat-history:v2:room:fast-password-verifier', JSON.stringify([{ payload: 'old' }, { payload: 'other-password' }]));
  archiveLegacyHistory(storage);
  assert.ok([...entries.keys()].every(key => !key.includes('fast-password-verifier')));
  await migrateRoomHistory(storage, 'room', 'modern', async cipher => {
    if (cipher === 'other-password') throw new Error('wrong key'); return 'new-ciphertext';
  }, 100);
  assert.deepEqual(JSON.parse(storage.getItem('modern')!), [{ payload: 'new-ciphertext' }]);
  assert.ok([...entries.values()].some(value => value.includes('other-password')));
});
