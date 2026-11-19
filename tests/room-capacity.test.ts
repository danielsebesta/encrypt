import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ChatRoom from '../party/chat';
import WhiteboardRoom from '../party/whiteboard';
import { AUTH_TIMEOUT_MS, MAX_JOINED, MAX_PENDING, type RoomConnection, type RoomHost, type RoomStorage } from '../party/access';
import { accessChannel } from '../src/lib/roomAccess';
import { FileBlobStore } from '../src/adapters/node/blobs';

const TOKEN = 'a'.repeat(64);

class Conn implements RoomConnection {
  state: unknown = null;
  closed: { code?: number; reason?: string } | null = null;
  sent: string[] = [];
  constructor(readonly id: string) {}
  setState(state: unknown) { this.state = state; }
  send(message: string) { this.sent.push(message); }
  close(code?: number, reason?: string) { this.closed ??= { code, reason }; }
}

async function harness(make: (host: RoomHost) => ChatRoom | WhiteboardRoom, env: Record<string, unknown> = {}) {
  const conns: Conn[] = [];
  const store = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => store.get(key),
    put: async (key: string | Record<string, unknown>, value?: unknown) => { if (typeof key === 'string') store.set(key, value); },
    setAlarm: async () => {},
  } as unknown as RoomStorage;
  const host: RoomHost = {
    name: await accessChannel(TOKEN),
    env,
    storage,
    getConnections: () => conns.filter(c => !c.closed),
  };
  const room = make(host);
  await (room as { onStart?(): unknown }).onStart?.();
  let n = 0;
  const connect = () => {
    const conn = new Conn(`c${n++}`);
    conns.push(conn);
    room.onConnect(conn);
    return conn;
  };
  const join = async (conn: Conn) => {
    await room.onMessage(JSON.stringify({ type: 'join', token: TOKEN, config: { mode: 'live', authMode: 'password', createdAt: 1, v: 3 } }), conn);
  };
  return { room, conns, connect, join };
}

for (const [label, make] of [
  ['chat', (host: RoomHost) => new ChatRoom(host)],
  ['whiteboard', (host: RoomHost) => new WhiteboardRoom(host)],
] as const) {
  test(`${label}: anonymous sockets cannot lock joined members out`, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const h = await harness(make);
      const pending = Array.from({ length: MAX_PENDING + 10 }, () => h.connect());
      const refused = pending.filter(c => c.closed);
      assert.equal(refused.length, 10);
      assert.ok(refused.every(c => c.closed?.code === 4008));
      for (const c of pending) c.close(1000);
      const members: Conn[] = [];
      for (let i = 0; i < MAX_JOINED - 1; i++) {
        const c = h.connect();
        await h.join(c);
        assert.equal(c.closed, null);
        members.push(c);
      }
      const extra = h.connect();
      const last = h.connect();
      await h.join(last);
      members.push(last);
      assert.equal(extra.closed, null);
      assert.equal(h.connect().closed?.code, 4008);
      await h.join(extra);
      assert.deepEqual(extra.closed, { code: 4008, reason: 'ROOM_FULL' });
      assert.ok(members.every(c => !c.closed));
    } finally {
      mock.timers.reset();
    }
  });

  test(`${label}: sockets that never join are closed after the auth timeout`, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const h = await harness(make);
      const idle = h.connect();
      const member = h.connect();
      await h.join(member);
      mock.timers.tick(AUTH_TIMEOUT_MS);
      assert.deepEqual(idle.closed, { code: 4003, reason: 'AUTH_TIMEOUT' });
      assert.equal(member.closed, null);
    } finally {
      mock.timers.reset();
    }
  });
}

test('chat: concurrent wake-ups pass the push cooldown once', async () => {
  const h = await harness(host => new ChatRoom(host), {
    VAPID_PUBLIC_KEY: 'A'.repeat(87),
    VAPID_PRIVATE_KEY: 'A'.repeat(43),
  });
  const room = h.room as unknown as { wakeSleepers(): Promise<void>; pushTargets(): Promise<unknown[]> };
  let started = 0;
  const gate = Promise.withResolvers<void>();
  room.pushTargets = async () => { started++; await gate.promise; return []; };
  const calls = [room.wakeSleepers(), room.wakeSleepers(), room.wakeSleepers()];
  gate.resolve();
  await Promise.all(calls);
  assert.equal(started, 1);
});

test('blob store: startup removes partial uploads but keeps finished ones', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blobs-'));
  try {
    const id = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
    mkdirSync(path.join(dir, '.tmp'), { recursive: true });
    writeFileSync(path.join(dir, '.tmp', `${id}.partial`), 'x');
    writeFileSync(path.join(dir, id), 'done');
    await new FileBlobStore(dir).init();
    assert.equal(existsSync(path.join(dir, '.tmp', `${id}.partial`)), false);
    assert.equal(existsSync(path.join(dir, id)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
