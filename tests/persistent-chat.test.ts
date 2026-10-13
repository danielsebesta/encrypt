import { test } from 'node:test';
import assert from 'node:assert/strict';
import Chat from '../party/chat';
import { accessChannel } from '../src/lib/roomAccess';
import { RoomAccess } from '../party/access';
import { normalizeChatMode, chatModeTtlSeconds, chatModeKeepsHistory, PERSISTENT_HISTORY_LIMIT, PERSISTENT_IDLE_DAYS } from '../src/lib/chatRoomSettings';
import {
  derivePersistentRoom, generateRoomKey, encryptMessage, decryptMessage,
  generateSigningIdentity, signPayload, verifyPayload, safetyNumber, keyCode,
} from '../src/lib/chatCrypto';
import { stampPayload, validPayload } from '../src/lib/chatProtocol';

const token = 'b'.repeat(64);
const PAYLOAD = 'A'.repeat(64);

function fakeRoom(name: string) {
  const connections: any[] = [];
  const stored = new Map<string, unknown>();
  const alarms: number[] = [];
  const sorted = () => [...stored.keys()].sort();
  const host = { name, env: {}, getConnections: () => connections.values(), storage: {
    get: async (key: string) => stored.get(key),
    put: async (key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === 'string') stored.set(key, value);
      else for (const [k, v] of Object.entries(key)) stored.set(k, v);
    },
    delete: async (key: string | string[]) => Array.isArray(key) ? key.filter(k => stored.delete(k)).length : stored.delete(key),
    list: async (options: { prefix?: string; limit?: number; startAfter?: string } = {}) => {
      const out = new Map<string, unknown>();
      for (const k of sorted()) {
        if (options.prefix && !k.startsWith(options.prefix)) continue;
        if (options.startAfter && k <= options.startAfter) continue;
        out.set(k, stored.get(k));
        if (options.limit && out.size >= options.limit) break;
      }
      return out;
    },
    deleteAll: async () => stored.clear(),
    setAlarm: async (time: number) => { alarms.push(time); },
    deleteAlarm: async () => { alarms.length = 0; },
  } } as any;
  function conn(id: string) {
    const c = { id, state: null as any, messages: [] as any[], closed: 0,
      setState(value: any) { this.state = value; }, send(value: string) { this.messages.push(JSON.parse(value)); }, close(code: number) { this.closed = code; } };
    connections.push(c); return c;
  }
  function drop(c: any) { const i = connections.indexOf(c); if (i >= 0) connections.splice(i, 1); }
  return { host, conn, drop, stored, alarms };
}

async function joined(server: Chat, room: ReturnType<typeof fakeRoom>, id: string, extra: Record<string, unknown> = {}) {
  const c = room.conn(id);
  server.onConnect(c as any);
  await server.onMessage(JSON.stringify({ type: 'join', token, config: { mode: 'persistent', authMode: 'password' }, ...extra }), c as any);
  return c;
}

const send = (server: Chat, c: any, id: string, persist = true) =>
  server.onMessage(JSON.stringify({ type: 'message', id, payload: PAYLOAD, persist }), c);

test('the persistent mode is only accepted where the saved-room class asks for it', () => {
  assert.equal(normalizeChatMode('persistent'), 'live');
  assert.equal(normalizeChatMode('persistent', true), 'persistent');
  assert.equal(normalizeChatMode('ttl-30', true), 'ttl-30');
  assert.equal(chatModeTtlSeconds('persistent'), 0);
  assert.equal(chatModeKeepsHistory('persistent'), true);
  assert.equal(chatModeKeepsHistory('ttl-30'), false);
});

test('live rooms never store persistent mode or messages, saved rooms never store a password mode', async () => {
  const live = fakeRoom(await accessChannel(token));
  const liveServer = new Chat(live.host);
  const a = await joined(liveServer, live, 'a');
  assert.deepEqual((live.stored.get('room-config') as any).mode, 'live');
  await send(liveServer, a, 'm1');
  assert.equal([...live.stored.keys()].some(k => k.startsWith('history:')), false);
  assert.equal(a.messages.some(m => m.type === 'stored'), false);

  const saved = fakeRoom(await accessChannel(token));
  const savedServer = new Chat(saved.host, { persistent: true });
  await joined(savedServer, saved, 'a');
  assert.deepEqual((saved.stored.get('room-config') as any).mode, 'persistent');
  assert.deepEqual((saved.stored.get('room-config') as any).authMode, 'fragment');
});

test('saved rooms keep flagged envelopes with a server sequence and replay them on join', async () => {
  const room = fakeRoom(await accessChannel(token));
  const server = new Chat(room.host, { persistent: true });
  const a = await joined(server, room, 'a');
  const b = await joined(server, room, 'b');
  await send(server, a, 'm1');
  await send(server, a, 'typing-1', false);
  await send(server, a, 'm2');
  const relayed = b.messages.filter(m => m.type === 'message');
  assert.deepEqual(relayed.map(m => [m.id, m.persist, m.serverSeq]), [['m1', true, 1], ['typing-1', false, undefined], ['m2', true, 2]]);
  assert.ok(relayed[0].createdAt > 0);
  const acks = a.messages.filter(m => m.type === 'stored');
  assert.deepEqual(acks.map(m => [m.id, m.serverSeq]), [['m1', 1], ['m2', 2]]);
  const epoch = acks[0].epoch;
  assert.equal(typeof epoch, 'string');

  const late = await joined(server, room, 'late');
  const history = late.messages.filter(m => m.type === 'history');
  assert.equal(history.length, 1);
  assert.equal(history[0].epoch, epoch);
  assert.deepEqual(history[0].messages.map((m: any) => [m.id, m.serverSeq, m.persist]), [['m1', 1, true], ['m2', 2, true]]);

  const back = await joined(server, room, 'back', { since: 1, epoch });
  assert.deepEqual(back.messages.filter(m => m.type === 'history')[0].messages.map((m: any) => m.id), ['m2']);
  const stale = await joined(server, room, 'stale', { since: 1, epoch: 'other' });
  assert.deepEqual(stale.messages.filter(m => m.type === 'history')[0].messages.map((m: any) => m.id), ['m1', 'm2']);
});

test('history is capped on the server and the oldest messages go first', async () => {
  const room = fakeRoom(await accessChannel(token));
  const server = new Chat(room.host, { persistent: true });
  // The per-connection rate limit is not under test here.
  server.access = new RoomAccess(room.host, 1_000_000);
  const a = await joined(server, room, 'a');
  for (let i = 1; i <= PERSISTENT_HISTORY_LIMIT + 5; i++) await send(server, a, `m${i}`);
  const keys = [...room.stored.keys()].filter(k => k.startsWith('history:')).sort();
  assert.equal(keys.length, PERSISTENT_HISTORY_LIMIT);
  assert.equal((room.stored.get(keys[0]) as any).id, 'm6');
  assert.equal((room.stored.get('history-meta') as any).count, PERSISTENT_HISTORY_LIMIT);
  const reader = await joined(server, room, 'reader');
  const replayed = reader.messages.filter(m => m.type === 'history').flatMap(m => m.messages);
  assert.equal(replayed.length, PERSISTENT_HISTORY_LIMIT);
  assert.equal(replayed[0].id, 'm6');
});

test('a member can delete a saved room for everyone, and an empty saved room waits 90 days', async () => {
  const room = fakeRoom(await accessChannel(token));
  const server = new Chat(room.host, { persistent: true });
  const a = await joined(server, room, 'a');
  const b = await joined(server, room, 'b');
  const outsider = room.conn('outsider');
  server.onConnect(outsider as any);
  await send(server, a, 'm1');
  await server.onMessage(JSON.stringify({ type: 'delete' }), outsider as any);
  assert.equal(room.stored.size > 0, true);
  await server.onMessage(JSON.stringify({ type: 'delete' }), b as any);
  assert.equal(room.stored.size, 0);
  for (const c of [a, b, outsider]) {
    assert.equal(c.closed, 4010);
    assert.ok(c.messages.some(m => m.type === 'room-deleted'));
  }
  for (const c of [a, b, outsider]) { room.drop(c); server.onClose(c as any); }
  const expected = Date.now() + PERSISTENT_IDLE_DAYS * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(room.alarms.at(-1)! - expected) < 5000);

  const live = fakeRoom(await accessChannel(token));
  const liveServer = new Chat(live.host);
  const c = await joined(liveServer, live, 'c');
  await liveServer.onMessage(JSON.stringify({ type: 'delete' }), c as any);
  assert.equal(live.stored.size, 1);
});

test('saved-room keys derive a 64-hex access token and a message key without a password hash', async () => {
  const key = await generateRoomKey();
  const a = await derivePersistentRoom(key, 'room');
  const again = await derivePersistentRoom(key, 'room');
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.equal(a.token, again.token);
  assert.equal(a.channel, await accessChannel(a.token));
  assert.notEqual((await derivePersistentRoom(key, 'other')).token, a.token);
  assert.equal(await decryptMessage(again.key, await encryptMessage(a.key, 'hello')), 'hello');
  await assert.rejects(derivePersistentRoom('short', 'room'));
});

test('signed payloads verify, tampering and foreign keys fail, and safety numbers are symmetric', async () => {
  const alice = await generateSigningIdentity();
  const bob = await generateSigningIdentity();
  const signed = JSON.parse(await signPayload(alice, stampPayload(JSON.stringify({ type: 'chat-message', text: 'hi', sender: 'A' }), 'room')));
  assert.equal(validPayload(signed, 'room'), true);
  assert.equal(await verifyPayload(signed), alice.publicKey);
  assert.equal(await verifyPayload({ ...signed, text: 'bye' }), null);
  assert.equal(await verifyPayload({ ...signed, _pk: bob.publicKey }), null);
  assert.equal(await verifyPayload({ ...signed, _sig: undefined }), null);
  assert.equal(await verifyPayload({ ...signed, _room: 'other' }), null);
  const { _sig, ...unsigned } = signed;
  assert.equal(await verifyPayload(unsigned), null);
  const ab = await safetyNumber(alice.publicKey, bob.publicKey);
  assert.equal(ab, await safetyNumber(bob.publicKey, alice.publicKey));
  assert.match(ab, /^\d{5} \d{5} \d{5} \d{5}$/);
  assert.notEqual(ab, await safetyNumber(alice.publicKey, (await generateSigningIdentity()).publicKey));
  assert.match(await keyCode(alice.publicKey), /^\d{5} \d{5}$/);
});
