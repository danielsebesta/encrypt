import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ForwardSecrecySession, ReceiveChains, SenderChain, PairKeys, createEphemeralKeyPair, wrapChainKey, unwrapChainKey,
  ROTATE_AFTER_MS, PENDING, type FsSealed,
} from '../src/lib/chatRatchet';
import {
  forwardLocalKey, sealLocal, openLocal, roomForwardSecret, legacyRoomForwardSecret, generateSigningIdentity, signPayload, verifyPayload,
} from '../src/lib/chatCrypto';
import { hkdfKey } from '../src/lib/kdf';
import { stampPayload, validPayload } from '../src/lib/chatProtocol';

const random = (n = 32) => crypto.getRandomValues(new Uint8Array(n));
const hex = (n: number) => Array.from(random(n), (b) => b.toString(16).padStart(2, '0')).join('');
const KID = 'k'.repeat(16);

test('a receiving chain derives the sender message keys, each exactly once, in or out of order', async () => {
  const chain = new SenderChain(Date.now(), false);
  const grant = await chain.grant(false, Date.now());
  const receive = new ReceiveChains();
  assert.equal(receive.add('alice', chain.keyId, grant.index, grant.key), true);
  const sent: Uint8Array[] = [];
  for (let i = 0; i < 5; i++) sent.push((await chain.next()).messageKey);
  for (const i of [0, 3, 1, 4, 2]) assert.deepEqual(await receive.messageKey('alice', chain.keyId, i), sent[i]);
  for (const i of [0, 3, 4]) assert.equal(await receive.messageKey('alice', chain.keyId, i), null);
  assert.equal(receive.skippedCount, 0);
  assert.equal(await receive.messageKey('alice', 'x'.repeat(16), 5), null);
  assert.notDeepEqual(sent[0], sent[1]);
});

test('skipped keys are bounded and expire, and a jump beyond the skip limit is refused', async () => {
  let now = 1_000_000;
  const receive = new ReceiveChains(() => now, { maxSkip: 10, maxSkipped: 5, skippedTtlMs: 1000, retiredMs: 500 });
  const chain = new SenderChain(now, false);
  const grant = await chain.grant(false, now);
  receive.add('bob', chain.keyId, grant.index, grant.key);
  assert.equal(await receive.messageKey('bob', chain.keyId, 11), null);
  assert.ok(await receive.messageKey('bob', chain.keyId, 8));
  assert.equal(receive.skippedCount, 5);
  assert.equal(await receive.messageKey('bob', chain.keyId, 0), null);
  assert.ok(await receive.messageKey('bob', chain.keyId, 5));
  assert.equal(receive.skippedCount, 4);
  now += 2000;
  assert.equal(await receive.messageKey('bob', chain.keyId, 6), null);
  assert.equal(receive.skippedCount, 0);
});

test('a newer chain from the same sender retires the older one after a grace period, but its skipped keys survive', async () => {
  let now = 5_000_000;
  const receive = new ReceiveChains(() => now, { maxSkip: 100, maxSkipped: 100, skippedTtlMs: 60_000, retiredMs: 500 });
  const old = new SenderChain(now, false);
  const first = await old.grant(false, now);
  receive.add('carol', old.keyId, first.index, first.key);
  assert.ok(await receive.messageKey('carol', old.keyId, 2));
  const fresh = new SenderChain(now, false);
  const second = await fresh.grant(false, now);
  receive.add('carol', fresh.keyId, second.index, second.key);
  assert.ok(await receive.messageKey('carol', old.keyId, 3));
  now += 600;
  assert.equal(await receive.messageKey('carol', old.keyId, 4), null);
  assert.ok(await receive.messageKey('carol', old.keyId, 1));
  assert.ok(await receive.messageKey('carol', fresh.keyId, 0));
});

test('a pairwise key needs both the ephemeral key exchange and the room secret and binds both identities, the room and the key id', async () => {
  const secret = random();
  const [a, b, c] = await Promise.all([createEphemeralKeyPair(), createEphemeralKeyPair(), createEphemeralKeyPair()]);
  const alice = { pk: 'A'.repeat(43), pub: a.publicKey };
  const bob = { pk: 'B'.repeat(43), pub: b.publicKey };
  const aKeys = new PairKeys(a, secret);
  const bKeys = new PairKeys(b, secret);
  const keyA = await aKeys.derive('chain', 'room', alice, bob, KID);
  assert.deepEqual(await bKeys.derive('chain', 'room', alice, bob, KID), keyA);
  const chainKey = random();
  const wrapped = await wrapChainKey(keyA, chainKey, KID, 7);
  assert.match(wrapped, /^[A-Za-z0-9_-]{80}$/);
  assert.deepEqual(await unwrapChainKey(await bKeys.derive('chain', 'room', alice, bob, KID), wrapped, KID, 7), chainKey);
  assert.equal(await unwrapChainKey(keyA, wrapped, KID, 8), null);

  const otherPassword = await new PairKeys(b, random()).derive('chain', 'room', alice, bob, KID);
  assert.equal(await unwrapChainKey(otherPassword, wrapped, KID, 7), null);
  const otherEphemeral = await new PairKeys(c, secret).derive('chain', 'room', alice, { pk: bob.pk, pub: c.publicKey }, KID);
  assert.equal(await unwrapChainKey(otherEphemeral, wrapped, KID, 7), null);

  const variants: [typeof alice, typeof bob, string, string, 'chain' | 'sync'][] = [
    [bob, alice, KID, 'room', 'chain'],
    [{ ...alice, pk: 'C'.repeat(43) }, bob, KID, 'room', 'chain'],
    [alice, { ...bob, pk: 'D'.repeat(43) }, KID, 'room', 'chain'],
    [alice, bob, 'x'.repeat(16), 'room', 'chain'],
    [alice, bob, KID, 'other-room', 'chain'],
    [alice, bob, KID, 'room', 'sync'],
  ];
  for (const [from, to, id, room, purpose] of variants) {
    assert.equal(await unwrapChainKey(await bKeys.derive(purpose, room, from, to, id), wrapped, KID, 7), null, `${purpose} ${room} ${id}`);
  }
  await assert.rejects(aKeys.derive('chain', 'room', bob, { pk: 'E'.repeat(43), pub: c.publicKey }, KID));
});

type Peer = {
  name: string;
  clientId: string;
  pk: string;
  session: ForwardSecrecySession;
  read: string[];
  pending: number;
};

// An in-order relay like the server: sends only queue, and flush delivers everything in arrival order.
class Relay {
  online = new Set<Peer>();
  queue: { from: Peer; to: Peer; payload: any }[] = [];
  log: { from: Peer; payload: any }[] = [];

  send(from: Peer, payload: any) {
    this.log.push({ from, payload });
    for (const to of this.online) if (to !== from) this.queue.push({ from, to, payload });
  }

  async flush() {
    while (this.queue.length) {
      const { from, to, payload } = this.queue.shift()!;
      if (this.online.has(to)) await handle(this, to, from, payload);
    }
  }
}

async function handle(relay: Relay, me: Peer, from: Peer, payload: any) {
  const member = { clientId: from.clientId, pk: from.pk, pub: payload.fs };
  if (payload.type === 'fs') {
    const result = await me.session.open(from.pk, payload);
    if (typeof result === 'string') me.read.push(result);
    if (result === PENDING) me.pending++;
  } else if (payload.type === 'fs-key') {
    const released = await me.session.acceptGrant(from.pk, payload);
    await me.session.memberSeen(member);
    for (const item of released) {
      const result = await me.session.open(item.sender, item.outer);
      if (typeof result === 'string') me.read.push(result);
    }
  } else if (payload.type === 'verify') {
    relay.send(me, { type: 'verify-ack', clientId: me.clientId, fs: me.session.publicKey });
    await me.session.memberJoined(member);
  } else if (payload.type === 'verify-ack' || payload.type === 'presence') {
    await me.session.memberSeen(member);
  }
}

async function peer(relay: Relay, name: string, secret: Uint8Array, now?: () => number): Promise<Peer> {
  const self = { name, clientId: hex(8), pk: `${name}${'x'.repeat(43 - name.length)}`, read: [], pending: 0 } as unknown as Peer;
  self.session = await ForwardSecrecySession.create({
    channel: 'room',
    self: { pk: self.pk, clientId: self.clientId },
    secret,
    send: async (payload) => relay.send(self, payload),
    now,
  });
  return self;
}

async function join(relay: Relay, newcomer: Peer) {
  relay.online.add(newcomer);
  relay.send(newcomer, { type: 'verify', clientId: newcomer.clientId, fs: newcomer.session.publicKey });
  await relay.flush();
}

async function say(relay: Relay, from: Peer, text: string): Promise<FsSealed> {
  const sealed = await from.session.seal(text);
  relay.send(from, sealed);
  return sealed;
}

async function leave(relay: Relay, gone: Peer) {
  relay.online.delete(gone);
  for (const p of relay.online) await p.session.memberLeft();
  for (const p of relay.online) relay.send(p, { type: 'presence', clientId: p.clientId, fs: p.session.publicKey });
}

test('members read each other, whoever left cannot follow the new chains, and late answers still get the whole new chain', async () => {
  const relay = new Relay();
  const secret = random();
  const [alice, bob, carol] = [await peer(relay, 'alice', secret), await peer(relay, 'bob', secret), await peer(relay, 'carol', secret)];
  for (const p of [alice, bob, carol]) await join(relay, p);

  await say(relay, alice, 'one');
  await say(relay, bob, 'two');
  await relay.flush();
  assert.deepEqual(bob.read, ['one']);
  assert.deepEqual(carol.read, ['one', 'two']);
  assert.deepEqual(alice.read, ['two']);

  const before = alice.session.chainKeyId;
  await leave(relay, carol);
  assert.notEqual(alice.session.chainKeyId, before);
  const early = await say(relay, alice, 'three');
  await relay.flush();
  assert.deepEqual(bob.read, ['one', 'three']);
  assert.equal(bob.pending, 1);

  const later = await say(relay, alice, 'four');
  await say(relay, bob, 'five');
  await relay.flush();
  assert.deepEqual(bob.read, ['one', 'three', 'four']);
  assert.deepEqual(alice.read, ['two', 'five']);

  for (const { from, payload } of relay.log) {
    if (payload.type !== 'fs-key') continue;
    assert.deepEqual(await carol.session.acceptGrant(from.pk, payload), []);
    assert.deepEqual(await carol.session.acceptGrant(from.pk, { ...payload, keys: payload.keys.map((k: any) => ({ ...k, to: carol.clientId })) }), []);
  }
  for (const sealed of [early, later]) assert.equal(await carol.session.open(alice.pk, sealed), PENDING);
  assert.deepEqual(carol.read, ['one', 'two']);
});

test('a newcomer gets every chain at its current step and cannot read anything sent before it arrived', async () => {
  const relay = new Relay();
  const secret = random();
  const [alice, bob, dave] = [await peer(relay, 'alice', secret), await peer(relay, 'bob', secret), await peer(relay, 'dave', secret)];
  await join(relay, alice);
  await join(relay, bob);
  const earlier = [await say(relay, alice, 'before 1'), await say(relay, alice, 'before 2')];
  await relay.flush();
  await join(relay, dave);
  for (const sealed of earlier) assert.equal(await dave.session.open(alice.pk, sealed), null);
  await say(relay, alice, 'after');
  await say(relay, bob, 'hi dave');
  await relay.flush();
  assert.deepEqual(dave.read, ['after', 'hi dave']);
  await say(relay, dave, 'hello');
  await relay.flush();
  assert.deepEqual(alice.read.at(-1), 'hello');
  assert.deepEqual(bob.read.at(-1), 'hello');
});

test('a chain is replaced after its time is up and handed to the members present', async () => {
  let now = Date.now();
  const relay = new Relay();
  const secret = random();
  const alice = await peer(relay, 'alice', secret, () => now);
  const bob = await peer(relay, 'bob', secret, () => now);
  await join(relay, alice);
  await join(relay, bob);
  await say(relay, alice, 'old chain');
  const first = alice.session.chainKeyId;
  now += ROTATE_AFTER_MS + 1;
  await say(relay, alice, 'new chain');
  await relay.flush();
  assert.notEqual(alice.session.chainKeyId, first);
  assert.deepEqual(bob.read, ['old chain', 'new chain']);
});

test('a member asking again gets a fresh grant, and messages that waited for it are released in order', async () => {
  const relay = new Relay();
  const secret = random();
  const alice = await peer(relay, 'alice', secret);
  const bob = await peer(relay, 'bob', secret);
  await join(relay, alice);
  await join(relay, bob);
  await say(relay, alice, 'lost grant');
  relay.queue = relay.queue.filter((item) => item.payload.type !== 'fs-key');
  await relay.flush();
  assert.equal(bob.pending, 1);
  assert.deepEqual(bob.session.wanted(), [alice.pk]);
  const parked = await say(relay, alice, 'parked');
  relay.queue = [];
  await alice.session.memberWants({ clientId: bob.clientId, pk: bob.pk, pub: bob.session.publicKey });
  await relay.flush();
  assert.deepEqual(bob.read, ['lost grant']);
  assert.equal(await bob.session.open(alice.pk, parked), 'parked');
  await say(relay, alice, 'after');
  await relay.flush();
  assert.deepEqual(bob.read, ['lost grant', 'after']);
});

test('history handed to a newcomer opens only for that newcomer', async () => {
  const relay = new Relay();
  const secret = random();
  const [alice, bob, eve] = [await peer(relay, 'alice', secret), await peer(relay, 'bob', secret), await peer(relay, 'eve', secret)];
  const bobMember = { clientId: bob.clientId, pk: bob.pk, pub: bob.session.publicKey };
  const sync = await alice.session.sealSync(bobMember, ['{"a":1}', '{"b":2}']);
  assert.equal(sync.to, bob.clientId);
  assert.deepEqual(await bob.session.openSync(alice.pk, sync), ['{"a":1}', '{"b":2}']);
  assert.equal(await eve.session.openSync(alice.pk, sync), null);
  assert.equal(await eve.session.openSync(alice.pk, { ...sync, to: eve.clientId }), null);
  assert.equal(await bob.session.openSync(eve.pk, sync), null);
  bob.session.destroy();
  assert.equal(await bob.session.openSync(alice.pk, sync), null);
});

test('the forward secrecy secret depends on the room secret and mode, and old rooms derive one from the password', async () => {
  const base = await hkdfKey(random());
  const live = await roomForwardSecret(base, 'live');
  assert.equal(live.length, 32);
  assert.notDeepEqual(live, await roomForwardSecret(base, 'ttl-60'));
  assert.deepEqual(live, await roomForwardSecret(base, 'live'));
  const legacy = await legacyRoomForwardSecret('correct horse battery staple', 'room', 'live');
  assert.deepEqual(legacy, await legacyRoomForwardSecret('correct horse battery staple', 'room', 'live'));
  assert.notDeepEqual(legacy, await legacyRoomForwardSecret('correct horse battery staple', 'room', 'ttl-60'));
});

test('local history keeps the signed plaintext under its own key, so a reload still verifies it and nothing else opens it', async () => {
  const secret = random();
  const key = await forwardLocalKey(secret);
  const identity = await generateSigningIdentity();
  const signed = await signPayload(identity, stampPayload(JSON.stringify({ type: 'chat-message', id: 'm1', text: 'kept' }), 'room'));
  const sealed = await sealLocal(key, 'm1', signed);
  assert.equal(sealed.includes('kept'), false);
  const reopened = await openLocal(await forwardLocalKey(secret), 'm1', sealed);
  assert.equal(reopened, signed);
  const parsed = JSON.parse(reopened!);
  assert.equal(await verifyPayload(parsed), identity.publicKey);
  assert.equal(validPayload(parsed, 'room', true), true);
  assert.equal(await openLocal(key, 'm2', sealed), null);
  assert.equal(await openLocal(await forwardLocalKey(random()), 'm1', sealed), null);
});
