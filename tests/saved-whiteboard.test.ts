import { test } from 'node:test';
import assert from 'node:assert/strict';
import Whiteboard from '../party/whiteboard';
import { RoomAccess } from '../party/access';
import { accessChannel } from '../src/lib/roomAccess';
import { derivePersistentRoom, generateRoomKey, generateSigningIdentity } from '../src/lib/chatCrypto';
import { deriveSavedBoardAccess, sealBoardMessage, openBoardMessage } from '../src/lib/whiteboardCrypto';
import { sealEnvelope, openEnvelope, stampEnvelope, validEnvelope, LIVE_MAX_AGE_MS } from '../src/lib/whiteboardProtocol';
import { SAVED_BOARD_IDLE_DAYS } from '../src/lib/whiteboardSync';

const token = 'c'.repeat(64);
const payload = (n: number, char = 'A') => char.repeat(n);

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

async function board(options: { saved?: boolean; maxBytes?: number } = { saved: true }) {
  const room = fakeRoom(await accessChannel(token));
  const server = new Whiteboard(room.host, options);
  // The per-connection rate limit is not under test here.
  server.access = new RoomAccess(room.host, 1_000_000);
  const join = async (id: string, extra: Record<string, unknown> = {}) => {
    const c = room.conn(id);
    server.onConnect(c as any);
    await server.onMessage(JSON.stringify({ type: 'join', token, ...extra }), c as any);
    return c;
  };
  const send = (c: any, id: string, body = payload(64), kind = 'doc') =>
    server.onMessage(JSON.stringify({ type: 'envelope', kind, payload: body, id }), c);
  const snapshot = (c: any, base: number, index: number, total: number, id: string, body = payload(64, 'S')) =>
    server.onMessage(JSON.stringify({ type: 'snapshot', base, index, total, kind: total > 1 ? 'doc-part' : 'doc', payload: body, id }), c);
  const history = (c: any) => c.messages.filter((m: any) => m.type === 'history');
  const replay = (c: any) => history(c).flatMap((m: any) => m.entries);
  return { room, server, join, send, snapshot, history, replay };
}

test('saved-board keys derive their own access token and message key from the link, unlike chat', async () => {
  const key = await generateRoomKey();
  const a = await deriveSavedBoardAccess(key, 'room');
  const again = await deriveSavedBoardAccess(key, 'room');
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.equal(a.token, again.token);
  assert.equal(a.channel, await accessChannel(a.token));
  assert.notEqual((await deriveSavedBoardAccess(key, 'other')).token, a.token);
  assert.notEqual((await derivePersistentRoom(key, 'room')).token, a.token);
  assert.equal(await openBoardMessage(again.key, await sealBoardMessage(a.key, 'hello')), 'hello');
  const other = await deriveSavedBoardAccess(await generateRoomKey(), 'room');
  await assert.rejects(openBoardMessage(other.key, await sealBoardMessage(a.key, 'hello')));
  await assert.rejects(deriveSavedBoardAccess('short', 'room'));
  await assert.rejects(deriveSavedBoardAccess('!'.repeat(43), 'room'));
});

test('only stored document updates may be older than a minute, and only when replayed from storage', async () => {
  const now = 1_760_000_000_000;
  const old = now + LIVE_MAX_AGE_MS * 60;
  const doc = stampEnvelope('doc', { data: 'AAAA' }, 'room', now);
  assert.equal(validEnvelope(doc, 'doc', 'room', old), false);
  assert.equal(validEnvelope(doc, 'doc', 'room', old, true), true);
  assert.equal(validEnvelope(stampEnvelope('doc-part', { data: 'AAAA' }, 'room', now), 'doc-part', 'room', old, true), true);
  assert.equal(validEnvelope(stampEnvelope('cursor', { x: 1, y: 1, alias: [1, 2, 3] }, 'room', now), 'cursor', 'room', old, true), false);
  assert.equal(validEnvelope(doc, 'doc', 'other', old, true), false);
  const access = await deriveSavedBoardAccess(await generateRoomKey(), 'room');
  const me = await generateSigningIdentity();
  const sealed = await sealEnvelope(access.key, me, 'doc', { data: 'AAAA' }, access.channel);
  assert.ok(await openEnvelope(access.key, sealed, 'doc', access.channel, Date.now() + LIVE_MAX_AGE_MS * 2, true));
  assert.equal(await openEnvelope(access.key, sealed, 'doc', access.channel, Date.now() + LIVE_MAX_AGE_MS * 2), null);
});

test('live boards store nothing, saved boards number and keep document updates and replay them on join', async () => {
  const live = await board({});
  const la = await live.join('a');
  await live.join('b');
  await live.send(la, 'u1');
  assert.equal(live.room.stored.size, 0);
  assert.equal(la.messages.some((m: any) => m.type === 'history' || m.type === 'stored'), false);

  const { room, join, send, history, replay } = await board();
  const a = await join('a');
  const b = await join('b');
  assert.deepEqual(history(a).map((m: any) => [m.epoch, m.seq, m.entries.length, m.more]), [[null, 0, 0, false]]);
  await send(a, 'u1');
  await send(a, 'c1', payload(64), 'cursor');
  await send(a, 'u2', payload(64), 'doc-part');
  const relayed = b.messages.filter((m: any) => m.type === 'envelope');
  assert.deepEqual(relayed.map((m: any) => [m.id, m.kind, m.seq, m.from]), [['u1', 'doc', 1, 'a'], ['c1', 'cursor', undefined, 'a'], ['u2', 'doc-part', 2, 'a']]);
  const acks = a.messages.filter((m: any) => m.type === 'stored');
  assert.deepEqual(acks.map((m: any) => [m.id, m.seq]), [['u1', 1], ['u2', 2]]);
  const epoch = acks[0].epoch;
  assert.equal(typeof epoch, 'string');
  assert.equal([...room.stored.keys()].filter(k => k.startsWith('log:') && k.length === 16).length, 2);

  const late = await join('late');
  assert.deepEqual(replay(late).map((e: any) => [e.id, e.kind, e.seq, e.from]), [['u1', 'doc', 1, 'a'], ['u2', 'doc-part', 2, 'a']]);
  assert.equal(history(late).at(-1).seq, 2);
  assert.equal(history(late).at(-1).epoch, epoch);

  const back = await join('back', { since: 1, epoch });
  assert.deepEqual(replay(back).map((e: any) => e.id), ['u2']);
  const stale = await join('stale', { since: 1, epoch: 'other' });
  assert.deepEqual(replay(stale).map((e: any) => e.id), ['u1', 'u2']);

  await live.server.onMessage(JSON.stringify({ type: 'envelope-to', to: 'b', kind: 'doc', payload: payload(64), id: 'x' }), la as any);
  assert.equal(live.room.stored.size, 0);
  const saved = await board();
  const s1 = await saved.join('s1');
  const s2 = await saved.join('s2');
  await saved.server.onMessage(JSON.stringify({ type: 'envelope-to', to: 's2', kind: 'doc', payload: payload(64), id: 'x' }), s1 as any);
  assert.equal(s2.messages.some((m: any) => m.id === 'x'), false);
  assert.equal(saved.room.stored.size, 0);
});

test('large envelopes are spread over several storage keys and come back whole', async () => {
  const { room, join, send, replay } = await board();
  const a = await join('a');
  const big = payload(250_000, 'B') + payload(5, 'C');
  await send(a, 'big', big, 'doc-part');
  const keys = [...room.stored.keys()].filter(k => k.startsWith('log:')).sort();
  assert.deepEqual(keys, ['log:000000000001', 'log:000000000001:000', 'log:000000000001:001', 'log:000000000001:002']);
  for (const k of keys.slice(1)) assert.ok((room.stored.get(k) as string).length <= 100_000);
  const reader = await join('reader');
  assert.equal(replay(reader)[0].payload, big);
  assert.ok(reader.messages.filter((m: any) => m.type === 'history').every((m: any) => JSON.stringify(m).length < 1024 * 1024));
});

test('a snapshot replaces the log it covers, keeps later updates and is refused when stale or busy', async () => {
  const { room, server, join, send, snapshot, replay } = await board();
  const a = await join('a');
  const b = await join('b');
  for (let i = 1; i <= 3; i++) await send(a, `u${i}`);

  await snapshot(b, 2, 0, 2, 's0');
  await snapshot(a, 2, 0, 1, 'other');
  assert.ok(a.messages.some((m: any) => m.type === 'snapshot-busy'));
  await send(a, 'u4');
  await snapshot(b, 2, 1, 2, 's1');
  assert.deepEqual(b.messages.filter((m: any) => m.type === 'snapshot-saved').map((m: any) => m.base), [2]);

  const logs = [...room.stored.keys()].filter(k => k.startsWith('log:') && k.length === 16).sort();
  assert.deepEqual(logs, ['log:000000000003', 'log:000000000004']);
  const meta = room.stored.get('board-meta') as any;
  assert.equal(meta.base, 2);
  assert.equal(meta.seq, 4);
  assert.equal(meta.logCount, 2);

  const reader = await join('reader');
  assert.deepEqual(replay(reader).map((e: any) => [e.id, e.seq]), [['s0', 2], ['s1', 2], ['u3', 3], ['u4', 4]]);
  assert.equal(replay(reader)[0].from, 'snapshot');

  await snapshot(a, 2, 0, 1, 'late');
  assert.ok(a.messages.some((m: any) => m.type === 'snapshot-stale'));
  await snapshot(a, 9, 0, 1, 'future');
  assert.equal(a.messages.filter((m: any) => m.type === 'snapshot-stale').length, 2);

  await snapshot(a, 4, 0, 1, 'next', payload(64, 'N'));
  const snaps = [...room.stored.keys()].filter(k => k.startsWith('snap:') && k.split(':').length === 3);
  assert.equal(snaps.length, 1);
  assert.equal([...room.stored.keys()].some(k => k.startsWith('log:')), false);
  const fresh = await join('fresh');
  assert.deepEqual(replay(fresh).map((e: any) => e.id), ['next']);

  await send(a, 'u5');
  await snapshot(b, 5, 0, 3, 'half-0');
  room.drop(b);
  server.onClose(b as any);
  await server.onMessage(JSON.stringify({ type: 'noop' }), a as any);
  assert.equal([...room.stored.keys()].filter(k => k.startsWith('snap:') && k.split(':').length === 3).length, 1);
  const after = await join('after');
  assert.deepEqual(replay(after).map((e: any) => e.id), ['next', 'u5']);
});

test('saved boards refuse updates past their cap and ask a member to compact a growing log', async () => {
  const { join, send } = await board({ saved: true, maxBytes: 4_000 });
  const a = await join('a');
  const b = await join('b');
  for (let i = 1; i <= 6; i++) await send(a, `u${i}`, payload(700));
  assert.deepEqual(a.messages.filter((m: any) => m.type === 'board-full').map((m: any) => m.id), ['u6']);
  assert.equal(b.messages.some((m: any) => m.id === 'u6'), false);
  assert.equal(a.messages.filter((m: any) => m.type === 'stored' && m.compact).length, 1);
});

test('a member can delete a saved board for everyone, and an empty saved board waits 90 days', async () => {
  const { room, server, join, send } = await board();
  const a = await join('a');
  const b = await join('b');
  const outsider = room.conn('outsider');
  server.onConnect(outsider as any);
  await send(a, 'u1');
  await server.onMessage(JSON.stringify({ type: 'delete' }), outsider as any);
  assert.ok(room.stored.size > 0);
  await server.onMessage(JSON.stringify({ type: 'delete' }), b as any);
  assert.equal(room.stored.size, 0);
  for (const c of [a, b, outsider]) {
    assert.equal(c.closed, 4010);
    assert.ok(c.messages.some((m: any) => m.type === 'room-deleted'));
  }
  for (const c of [a, b, outsider]) { room.drop(c); server.onClose(c as any); }
  const expected = Date.now() + SAVED_BOARD_IDLE_DAYS * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(room.alarms.at(-1)! - expected) < 5000);

  const idle = await board();
  const c = await idle.join('c');
  await idle.send(c, 'u1');
  await idle.server.onAlarm();
  assert.ok(idle.room.stored.size > 0);
  idle.room.drop(c);
  idle.server.onClose(c as any);
  await idle.server.onAlarm();
  assert.equal(idle.room.stored.size, 0);

  const live = await board({});
  const l = await live.join('l');
  await live.server.onMessage(JSON.stringify({ type: 'delete' }), l as any);
  assert.equal(l.closed, 0);
  assert.equal(live.room.alarms.length, 0);
});
