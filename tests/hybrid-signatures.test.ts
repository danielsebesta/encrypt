import { test } from 'node:test';
import assert from 'node:assert/strict';
import Chat from '../party/chat';
import { pqIdentity, PqKeyring, pqKeyHash } from '../src/lib/chatPq';
import {
  generateSigningIdentity, signPayload, verifySigned, verifyPayload, signerId, validSignerId, safetyNumber, keyCode,
  encryptMessage, decryptMessage, generateRoomKey, importRoomKey, b64urlToArray,
} from '../src/lib/chatCrypto';
import { padme, padPayload, SIGNATURE_BYTES, PQ_SIGNATURE_BYTES } from '../src/lib/padding';
import { stampPayload, validPayload } from '../src/lib/chatProtocol';
import { PERSISTENT_PAYLOAD_CHARS } from '../src/lib/chatRoomSettings';
import { accessChannel } from '../src/lib/roomAccess';

const seed = () => crypto.getRandomValues(new Uint8Array(32));
const stamped = (body: Record<string, unknown>) => stampPayload(JSON.stringify({ type: 'chat-message', id: 'm1', text: 'hello', ...body }), 'room');

async function member() {
  const ed = await generateSigningIdentity();
  const pq = await pqIdentity(seed());
  return { ed, pq, id: signerId(ed.publicKey, pq.keyHash) };
}

test('an ML-DSA-44 key comes back from its seed and is filed only under the hash of its own bytes', async () => {
  const s = seed();
  const a = await pqIdentity(s);
  const b = await pqIdentity(s);
  assert.equal(a.publicKey, b.publicKey);
  assert.equal(a.publicKey.length, 1750);
  assert.equal(a.keyHash, await pqKeyHash(b64urlToArray(a.publicKey)));
  const ring = new PqKeyring();
  const other = await pqIdentity(seed());
  assert.equal(await ring.add(other.publicKey, a.keyHash), null);
  assert.equal(ring.has(a.keyHash), false);
  assert.equal(await ring.add(a.publicKey, a.keyHash), a.keyHash);
  assert.equal(await ring.add('A'.repeat(1749)), null);
  assert.equal(ring.verify('x'.repeat(43), new Uint8Array(1), new Uint8Array(2420)), null);
});

test('a hybrid payload counts only with both signatures valid over the same bytes, which name both keys', async () => {
  const alice = await member();
  const ring = new PqKeyring();
  await ring.add(alice.pq.publicKey);
  const json = await signPayload(alice.ed, stamped({}), alice.pq);
  const value = JSON.parse(json);
  assert.equal(value._pqk, alice.pq.keyHash);
  assert.equal(value._pq.length, 3227);
  assert.deepEqual(await verifySigned(value, ring.verify), { ed: alice.ed.publicKey, pq: alice.pq.keyHash });
  assert.equal(await verifyPayload(value), null);

  assert.equal(await verifySigned({ ...value, text: 'changed' }, ring.verify), null);
  const flipped = value._pq[10] === 'A' ? 'B' : 'A';
  assert.equal(await verifySigned({ ...value, _pq: value._pq.slice(0, 10) + flipped + value._pq.slice(11) }, ring.verify), null);
  const { _pq, ...noPq } = value;
  assert.equal(await verifySigned(noPq, ring.verify), null);
  const { _pqk, ...noKey } = noPq;
  assert.equal(await verifySigned(noKey, ring.verify), null);
  assert.equal(await verifySigned(value), null);
  assert.equal(await verifySigned(value, new PqKeyring().verify), null);

  const mallory = await member();
  await ring.add(mallory.pq.publicKey);
  const forged = JSON.parse(await signPayload(alice.ed, stamped({}), mallory.pq));
  assert.deepEqual(await verifySigned(forged, ring.verify), { ed: alice.ed.publicKey, pq: mallory.pq.keyHash });
  assert.notEqual(signerId(alice.ed.publicKey, mallory.pq.keyHash), alice.id);
  const swapped = { ...value, _pqk: mallory.pq.keyHash };
  assert.equal(await verifySigned(swapped, ring.verify), null);
});

test('an Ed25519-only payload is reported without a post-quantum key so a saved room can flag it', async () => {
  const old = await generateSigningIdentity();
  const value = JSON.parse(await signPayload(old, stamped({})));
  assert.deepEqual(await verifySigned(value, new PqKeyring().verify), { ed: old.publicKey, pq: null });
  assert.equal(await verifySigned({ ...value, _pq: 'A'.repeat(3227) }, new PqKeyring().verify), null);
});

test('a local copy without the ML-DSA signature still verifies with Ed25519 and keeps the key hash it was signed with', async () => {
  const alice = await member();
  const { _pq, ...local } = JSON.parse(await signPayload(alice.ed, stamped({}), alice.pq));
  assert.equal(await verifyPayload(local), alice.ed.publicKey);
  assert.equal(signerId(alice.ed.publicKey, local._pqk), alice.id);
  assert.equal(await verifyPayload({ ...local, _pqk: (await member()).pq.keyHash }), null);
});

test('the key code and the 60-digit safety number cover both keys of a saved-room member', async () => {
  const alice = await member();
  const bob = await member();
  const number = await safetyNumber(alice.id, bob.id);
  assert.match(number, /^(\d{5} ){11}\d{5}$/);
  assert.equal(await safetyNumber(bob.id, alice.id), number);
  const bobOtherPq = signerId(bob.ed.publicKey, (await pqIdentity(seed())).keyHash);
  assert.notEqual(await safetyNumber(alice.id, bobOtherPq), number);
  assert.notEqual(await safetyNumber(alice.id, bob.ed.publicKey), number);
  assert.notEqual(await keyCode(bobOtherPq), await keyCode(bob.id));
  assert.equal(validSignerId(alice.id), true);
  assert.equal(validSignerId(alice.ed.publicKey), true);
  assert.equal(validSignerId(`${alice.id}.x`), false);
});

test('hybrid signatures fill an exact padding bucket and a long message still fits the saved-room payload limit', async () => {
  const alice = await member();
  for (const text of ['hi', 'x'.repeat(2000)]) {
    const padded = padPayload(stamped({ text, _n: 12, _ph: 'h'.repeat(43) }), SIGNATURE_BYTES + PQ_SIGNATURE_BYTES);
    const signed = await signPayload(alice.ed, padded, alice.pq);
    const bytes = new TextEncoder().encode(signed).length;
    assert.equal(bytes, padme(bytes));
    assert.equal(validPayload(JSON.parse(signed), 'room', true), true);
    const sealed = await encryptMessage(await importRoomKey(await generateRoomKey()), signed);
    assert.ok(sealed.length < PERSISTENT_PAYLOAD_CHARS, `${sealed.length}`);
  }
});

test('payload fields for keys and chains are checked for shape', () => {
  const base = JSON.parse(stamped({}));
  const ok = (extra: Record<string, unknown>) => validPayload({ ...base, ...extra }, 'room', true);
  assert.equal(ok({ fs: 'B'.repeat(87) }), true);
  assert.equal(ok({ fs: 'B'.repeat(86) }), false);
  assert.equal(ok({ pq: 'C'.repeat(1750) }), true);
  assert.equal(ok({ pq: 'C'.repeat(1751) }), false);
  assert.equal(ok({ _pqk: 'D'.repeat(42) }), false);
  assert.equal(ok({ head: { n: 3, h: 'E'.repeat(43) } }), true);
  assert.equal(ok({ head: { n: -1, h: 'E'.repeat(43) } }), false);
  assert.equal(ok({ want: ['F'.repeat(43)] }), true);
  assert.equal(ok({ want: ['F'] }), false);
  assert.equal(ok({ to: '0123456789abcdef' }), true);
  assert.equal(ok({ to: 'not a client' }), false);
  assert.equal(ok({ k: 'G'.repeat(16), n: 4, c: 'abc_-' }), true);
  assert.equal(ok({ n: 1.5 }), false);
  assert.equal(ok({ file: { name: 'a', size: 1, urls: [], key: 'H'.repeat(43) } }), true);
  assert.equal(ok({ file: { name: 'a', size: 1, urls: [], key: 'short' } }), false);
});

function fakeRoom(name: string) {
  const connections: any[] = [];
  const stored = new Map<string, unknown>();
  const host = { name, env: {}, getConnections: () => connections.values(), storage: {
    get: async (key: string) => stored.get(key),
    put: async (key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === 'string') stored.set(key, value);
      else for (const [k, v] of Object.entries(key)) stored.set(k, v);
    },
    delete: async (key: string | string[]) => Array.isArray(key) ? key.filter((k) => stored.delete(k)).length : stored.delete(key),
    list: async (options: { prefix?: string } = {}) => new Map([...stored].filter(([k]) => !options.prefix || k.startsWith(options.prefix)).sort(([a], [b]) => a.localeCompare(b))),
    deleteAll: async () => stored.clear(),
    setAlarm: async () => {},
    deleteAlarm: async () => {},
  } } as any;
  function conn(id: string) {
    const c = { id, state: null as any, messages: [] as any[], closed: 0,
      setState(value: any) { this.state = value; }, send(value: string) { this.messages.push(JSON.parse(value)); }, close(code: number) { this.closed = code; } };
    connections.push(c);
    return c;
  }
  const drop = (c: unknown) => connections.splice(connections.indexOf(c), 1);
  return { host, conn, drop, stored };
}

test('a saved room keeps sealed member keys for offline members: one per connection, capped, handed out before history', async () => {
  const token = 'c'.repeat(64);
  const room = fakeRoom(await accessChannel(token));
  const server = new Chat(room.host, { persistent: true });
  const key = await importRoomKey(await generateRoomKey());
  const sealedKey = async () => encryptMessage(key, (await pqIdentity(seed())).publicKey);
  const join = async (id: string) => {
    const c = room.conn(id);
    server.onConnect(c as any);
    await server.onMessage(JSON.stringify({ type: 'join', token, config: { mode: 'persistent', authMode: 'fragment' } }), c as any);
    return c;
  };
  const a = await join('a');
  assert.deepEqual(a.messages.find((m) => m.type === 'member-keys').keys, []);
  const first = await sealedKey();
  assert.equal(first.length, 2371);
  await server.onMessage(JSON.stringify({ type: 'member-key', key: first }), a as any);
  await server.onMessage(JSON.stringify({ type: 'member-key', key: await sealedKey() }), a as any);
  await server.onMessage(JSON.stringify({ type: 'member-key', key: 'x'.repeat(2371) + '!' }), a as any);
  const b = await join('b');
  const types = b.messages.map((m) => m.type);
  assert.ok(types.indexOf('member-keys') < types.indexOf('history'));
  const listed = b.messages.find((m) => m.type === 'member-keys').keys;
  assert.deepEqual(listed, [first]);
  assert.equal((await decryptMessage(key, listed[0])).length, 1750);

  for (let i = 0; i < 130; i++) {
    const c = await join(`c${i}`);
    await server.onMessage(JSON.stringify({ type: 'member-key', key: await sealedKey() }), c as any);
    room.drop(c);
  }
  const keys = [...room.stored.keys()].filter((k) => k.startsWith('member-key:'));
  assert.equal(keys.length, 128);

  const live = fakeRoom(await accessChannel(token));
  const liveServer = new Chat(live.host);
  const l = live.conn('l');
  liveServer.onConnect(l as any);
  await liveServer.onMessage(JSON.stringify({ type: 'join', token, config: { mode: 'live', authMode: 'password' } }), l as any);
  await liveServer.onMessage(JSON.stringify({ type: 'member-key', key: first }), l as any);
  assert.equal(l.messages.some((m) => m.type === 'member-keys'), false);
  assert.equal([...live.stored.keys()].some((k) => k.startsWith('member-key:')), false);
});
