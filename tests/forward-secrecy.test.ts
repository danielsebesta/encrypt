import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ForwardSecrecySession, ReceiveChains, SenderChain, PairKeys, createEphemeralKeyPair, wrapChainKey, unwrapChainKey,
  ORIGIN_WINDOW_MS, ROTATE_AFTER_MS, PENDING, type FsSealed,
} from '../src/lib/chatRatchet';
import {
  forwardLocalKey, sealLocal, openLocal, roomForwardSecret, generateSigningIdentity, signPayload, verifyPayload,
} from '../src/lib/chatCrypto';
import { hkdfKey } from '../src/lib/kdf';
import { createKemKeyPair, kemOpen, kemSeal, validKemCiphertext, validKemKey } from '../src/lib/hybridKem';
import { isContent, relayedContentOk, stampPayload, validPayload } from '../src/lib/chatProtocol';

const random = (n = 32) => crypto.getRandomValues(new Uint8Array(n));
const hex = (n: number) => Array.from(random(n), (b) => b.toString(16).padStart(2, '0')).join('');
const KID = 'k'.repeat(16);

test('a receiving chain derives the sender message keys, each exactly once, in or out of order', async () => {
  const chain = new SenderChain(Date.now(), false);
  const grant = await chain.grant(false, Date.now());
  const receive = new ReceiveChains();
  assert.equal(receive.add('alice', 'tab', chain.keyId, grant.index, grant.key), true);
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
  receive.add('bob', 'tab', chain.keyId, grant.index, grant.key);
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

test('a newer chain from the same connection retires the older one after a grace period, but its skipped keys survive', async () => {
  let now = 5_000_000;
  const receive = new ReceiveChains(() => now, { maxSkip: 100, maxSkipped: 100, skippedTtlMs: 60_000, retiredMs: 500 });
  const old = new SenderChain(now, false);
  const first = await old.grant(false, now);
  receive.add('carol', 'tab', old.keyId, first.index, first.key);
  assert.ok(await receive.messageKey('carol', old.keyId, 2));
  const fresh = new SenderChain(now, false);
  const second = await fresh.grant(false, now);
  receive.add('carol', 'tab', fresh.keyId, second.index, second.key);
  assert.ok(await receive.messageKey('carol', old.keyId, 3));
  now += 600;
  assert.equal(await receive.messageKey('carol', old.keyId, 4), null);
  assert.ok(await receive.messageKey('carol', old.keyId, 1));
  assert.ok(await receive.messageKey('carol', fresh.keyId, 0));
});

test('chains of two connections that share a signing key live side by side, and dropping one connection keeps the other', async () => {
  let now = 6_000_000;
  const receive = new ReceiveChains(() => now, { maxSkip: 100, maxSkipped: 100, skippedTtlMs: 60_000, retiredMs: 500 });
  const first = new SenderChain(now, false);
  const second = new SenderChain(now, false);
  const a = await first.grant(false, now);
  const b = await second.grant(false, now);
  assert.equal(receive.add('dave', 'tab-1', first.keyId, a.index, a.key), true);
  assert.equal(receive.add('dave', 'tab-2', second.keyId, b.index, b.key), true);
  now += 10_000;
  assert.ok(await receive.messageKey('dave', first.keyId, 0));
  assert.ok(await receive.messageKey('dave', second.keyId, 0));
  receive.dropStream('tab-2');
  assert.equal(receive.has('dave', second.keyId), false);
  assert.ok(await receive.messageKey('dave', first.keyId, 1));
});

test('a pairwise key needs the ephemeral key exchange, the ML-KEM secret and the room secret and binds both identities, the room and the key id', async () => {
  const secret = random();
  const kemSecret = random();
  const [a, b, c] = await Promise.all([createEphemeralKeyPair(), createEphemeralKeyPair(), createEphemeralKeyPair()]);
  const alice = { pk: 'A'.repeat(43), pub: a.publicKey };
  const bob = { pk: 'B'.repeat(43), pub: b.publicKey };
  const aKeys = new PairKeys(a, secret);
  const bKeys = new PairKeys(b, secret);
  const keyA = await aKeys.derive('chain', 'room', alice, bob, KID, kemSecret);
  assert.deepEqual(await bKeys.derive('chain', 'room', alice, bob, KID, kemSecret), keyA);
  const chainKey = random();
  const wrapped = await wrapChainKey(keyA, chainKey, KID, 7);
  assert.match(wrapped, /^[A-Za-z0-9_-]{80}$/);
  assert.deepEqual(await unwrapChainKey(await bKeys.derive('chain', 'room', alice, bob, KID, kemSecret), wrapped, KID, 7), chainKey);
  assert.equal(await unwrapChainKey(keyA, wrapped, KID, 8), null);

  // Someone who broke P-256 and knows the password holds everything except the ML-KEM secret, and that is not enough.
  assert.equal(await unwrapChainKey(await bKeys.derive('chain', 'room', alice, bob, KID, random()), wrapped, KID, 7), null);
  const otherPassword = await new PairKeys(b, random()).derive('chain', 'room', alice, bob, KID, kemSecret);
  assert.equal(await unwrapChainKey(otherPassword, wrapped, KID, 7), null);
  const otherEphemeral = await new PairKeys(c, secret).derive('chain', 'room', alice, { pk: bob.pk, pub: c.publicKey }, KID, kemSecret);
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
    assert.equal(await unwrapChainKey(await bKeys.derive(purpose, room, from, to, id, kemSecret), wrapped, KID, 7), null, `${purpose} ${room} ${id}`);
  }
  await assert.rejects(aKeys.derive('chain', 'room', bob, { pk: 'E'.repeat(43), pub: c.publicKey }, KID, kemSecret));
  await assert.rejects(aKeys.derive('chain', 'room', alice, bob, KID, new Uint8Array(0)));
});

test('ML-KEM seals open only for the holder of the matching secret key', () => {
  const [bob, eve] = [createKemKeyPair(), createKemKeyPair()];
  assert.equal(validKemKey(bob.publicKey), true);
  assert.equal(validKemKey(bob.publicKey.slice(1)), false);
  const first = kemSeal(bob.publicKey);
  const second = kemSeal(bob.publicKey);
  assert.equal(validKemCiphertext(first.ciphertext), true);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.notDeepEqual(first.secret, second.secret);
  assert.deepEqual(kemOpen(bob.secretKey, first.ciphertext), first.secret);
  assert.notDeepEqual(kemOpen(eve.secretKey, first.ciphertext), first.secret);
  const flipped = `${first.ciphertext[0] === 'A' ? 'B' : 'A'}${first.ciphertext.slice(1)}`;
  assert.notDeepEqual(kemOpen(bob.secretKey, flipped), first.secret);
  assert.throws(() => kemSeal('not a key'));
  assert.throws(() => kemOpen(bob.secretKey, 'not a ciphertext'));
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
  const member = { clientId: from.clientId, pk: from.pk, pub: payload.fs, kem: payload.kem };
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
    relay.send(me, { type: 'verify-ack', ...announce(me) });
    await me.session.memberJoined(member);
  } else if (payload.type === 'verify-ack' || payload.type === 'presence') {
    await me.session.memberSeen(member);
  }
}

const announce = (who: Peer) => ({ clientId: who.clientId, fs: who.session.publicKey, kem: who.session.kemPublicKey });
const memberOf = (who: Peer) => ({ clientId: who.clientId, pk: who.pk, pub: who.session.publicKey, kem: who.session.kemPublicKey });

async function peer(relay: Relay, name: string, secret: Uint8Array, now?: () => number, pk = `${name}${'x'.repeat(43 - name.length)}`): Promise<Peer> {
  const self = { name, clientId: hex(8), pk, read: [], pending: 0 } as unknown as Peer;
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
  relay.send(newcomer, { type: 'verify', ...announce(newcomer) });
  await relay.flush();
}

async function say(relay: Relay, from: Peer, text: string): Promise<FsSealed> {
  const sealed = await from.session.seal(text);
  relay.send(from, sealed);
  return sealed;
}

async function leave(relay: Relay, gone: Peer) {
  relay.online.delete(gone);
  for (const p of relay.online) await p.session.memberLeft(gone.clientId);
  for (const p of relay.online) relay.send(p, { type: 'presence', ...announce(p) });
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

test('two tabs that share a signing key are both read, also after the grace period for retired chains', async () => {
  let now = Date.now();
  const relay = new Relay();
  const secret = random();
  const first = await peer(relay, 'alice', secret, () => now);
  const second = await peer(relay, 'alice', secret, () => now, first.pk);
  const bob = await peer(relay, 'bob', secret, () => now);
  for (const p of [first, bob, second]) await join(relay, p);
  await say(relay, first, 'one');
  await say(relay, second, 'two');
  await relay.flush();
  now += 31_000;
  await say(relay, first, 'three');
  await say(relay, second, 'four');
  await relay.flush();
  assert.deepEqual(bob.read, ['one', 'two', 'three', 'four']);
  assert.deepEqual(first.read, ['two', 'four']);
  assert.deepEqual(second.read, ['one', 'three']);
});

test('a member who leaves and comes back with the same client id within moments gets nothing sent while it was away', async () => {
  let now = Date.now();
  const relay = new Relay();
  const secret = random();
  const [alice, bob, carol] = [await peer(relay, 'alice', secret, () => now), await peer(relay, 'bob', secret, () => now), await peer(relay, 'carol', secret, () => now)];
  for (const p of [alice, bob, carol]) await join(relay, p);
  await say(relay, alice, 'before');
  await relay.flush();
  await leave(relay, carol);
  await relay.flush();
  const away = await say(relay, alice, 'while away');
  await relay.flush();
  assert.deepEqual(bob.read, ['before', 'while away']);

  now += 1000;
  await carol.session.reconnected();
  relay.online.add(carol);
  relay.send(carol, { type: 'presence', ...announce(carol) });
  await relay.flush();
  assert.equal(await carol.session.open(alice.pk, away), null);
  await say(relay, alice, 'back');
  await say(relay, carol, 'hi');
  await relay.flush();
  assert.deepEqual(carol.read, ['before', 'back']);
  assert.deepEqual(alice.read.at(-1), 'hi');
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
  await alice.session.memberWants(memberOf(bob));
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
  const bobMember = memberOf(bob);
  const sync = await alice.session.sealSync(bobMember, ['{"a":1}', '{"b":2}']);
  assert.equal(sync.to, bob.clientId);
  assert.deepEqual(await bob.session.openSync(alice.pk, sync), ['{"a":1}', '{"b":2}']);
  assert.equal(await eve.session.openSync(alice.pk, sync), null);
  assert.equal(await eve.session.openSync(alice.pk, { ...sync, to: eve.clientId }), null);
  assert.equal(await bob.session.openSync(eve.pk, sync), null);
  bob.session.destroy();
  assert.equal(await bob.session.openSync(alice.pk, sync), null);
});

test('nobody can drop the post-quantum part: without ML-KEM a member gets no chain and a grant opens nothing', async () => {
  const relay = new Relay();
  const secret = random();
  const [alice, bob] = [await peer(relay, 'alice', secret), await peer(relay, 'bob', secret)];
  await join(relay, alice);
  await join(relay, bob);
  relay.log = [];
  await alice.session.memberSeen({ clientId: 'c'.repeat(16), pk: 'C'.repeat(43), pub: bob.session.publicKey, kem: undefined as unknown as string });
  await alice.session.memberWants({ clientId: 'c'.repeat(16), pk: 'C'.repeat(43), pub: bob.session.publicKey, kem: 'x'.repeat(87) });
  await say(relay, alice, 'first');
  relay.queue = [];
  const grant = relay.log.find(({ payload }) => payload.type === 'fs-key')!.payload;
  assert.equal(grant.keys.length, 1);
  assert.equal(grant.keys[0].to, bob.clientId);
  assert.equal(validKemCiphertext(grant.keys[0].e), true);
  const without = { ...grant, keys: grant.keys.map(({ e, ...rest }: any) => rest) };
  assert.deepEqual(await bob.session.acceptGrant(alice.pk, without), []);
  const flipped = `${grant.keys[0].e[0] === 'A' ? 'B' : 'A'}${grant.keys[0].e.slice(1)}`;
  await bob.session.acceptGrant(alice.pk, { ...grant, keys: [{ ...grant.keys[0], e: flipped }] });
  assert.equal(await bob.session.open(alice.pk, await alice.session.seal('second')), PENDING);
  await bob.session.acceptGrant(alice.pk, grant);
  assert.equal(await bob.session.open(alice.pk, await alice.session.seal('third')), 'third');
});

test('history handed over without its ML-KEM ciphertext does not open', async () => {
  const relay = new Relay();
  const secret = random();
  const [alice, bob] = [await peer(relay, 'alice', secret), await peer(relay, 'bob', secret)];
  const sync = await alice.session.sealSync(memberOf(bob), ['{"a":1}']);
  const { e, ...without } = sync;
  assert.equal(await bob.session.openSync(alice.pk, without), null);
  assert.equal(await bob.session.openSync(alice.pk, { ...sync, e: `${e[0] === 'A' ? 'B' : 'A'}${e.slice(1)}` }), null);
  assert.deepEqual(await bob.session.openSync(alice.pk, sync), ['{"a":1}']);
});

test('a member who skips the join message still gets no chain from before it arrived', async () => {
  let now = Date.now();
  const relay = new Relay();
  const secret = random();
  const [alice, bob] = [await peer(relay, 'alice', secret, () => now), await peer(relay, 'bob', secret, () => now)];
  await join(relay, alice);
  await join(relay, bob);
  now += ORIGIN_WINDOW_MS + 1;
  await alice.session.memberLeft();
  relay.send(alice, { type: 'presence', ...announce(alice) });
  relay.send(bob, { type: 'presence', ...announce(bob) });
  await relay.flush();
  const before = await say(relay, alice, 'before mallory');
  await relay.flush();
  assert.deepEqual(bob.read.at(-1), 'before mallory');

  const mallory = await peer(relay, 'mallory', secret, () => now);
  relay.online.add(mallory);
  relay.send(mallory, { type: 'presence', ...announce(mallory) });
  await relay.flush();
  assert.equal(await mallory.session.open(alice.pk, before), null);
  await say(relay, alice, 'after mallory');
  await relay.flush();
  assert.deepEqual(mallory.read, ['after mallory']);
});

test('a member dropped by two quick departures and answering late still reads the new chain from its start', async () => {
  let now = Date.now();
  const relay = new Relay();
  const secret = random();
  const [alice, bob] = [await peer(relay, 'alice', secret, () => now), await peer(relay, 'bob', secret, () => now)];
  await join(relay, alice);
  await join(relay, bob);
  await say(relay, alice, 'hello');
  await relay.flush();
  now += ORIGIN_WINDOW_MS + 1;
  await alice.session.memberLeft();
  await alice.session.memberLeft();
  await say(relay, alice, 'sent before the answer');
  relay.send(bob, { type: 'presence', ...announce(bob) });
  await relay.flush();
  assert.deepEqual(bob.read, ['hello', 'sent before the answer']);
});

test('a member answering this session\'s own challenge late was here all along and reads the new chain from its start', async () => {
  let now = Date.now();
  const relay = new Relay();
  const secret = random();
  const [alice, bob] = [await peer(relay, 'alice', secret, () => now), await peer(relay, 'bob', secret, () => now)];
  relay.online.add(alice);
  relay.online.add(bob);
  now += ORIGIN_WINDOW_MS + 1;
  const first = await say(relay, alice, 'first');
  relay.queue = [];
  await alice.session.memberSeen(memberOf(bob), true);
  await relay.flush();
  assert.equal(await bob.session.open(alice.pk, first), 'first');
});

test('in its first moments a session still gives an unknown member the whole new chain', async () => {
  let now = Date.now();
  const relay = new Relay();
  const secret = random();
  const [alice, bob] = [await peer(relay, 'alice', secret, () => now), await peer(relay, 'bob', secret, () => now)];
  relay.online.add(alice);
  relay.online.add(bob);
  const first = await say(relay, alice, 'first');
  relay.queue = [];
  relay.send(bob, { type: 'presence', ...announce(bob) });
  await relay.flush();
  assert.equal(await bob.session.open(alice.pk, first), 'first');
});

test('rooms with forward secrecy refuse content sealed only under the room key', () => {
  const plain = { type: 'chat-message', id: 'm1', text: 'hi' };
  assert.equal(relayedContentOk(plain, true, false), false);
  assert.equal(relayedContentOk({ type: 'whiteboard-invite' }, true, false), false);
  assert.equal(relayedContentOk(plain, true, true), true);
  assert.equal(relayedContentOk({ type: 'presence' }, true, false), true);
  assert.equal(relayedContentOk(plain, false, false), true);
  assert.equal(isContent({ id: 'm1', text: 'untyped' }), false);
});

test('the forward secrecy secret depends on the room secret and mode', async () => {
  const base = await hkdfKey(random());
  const live = await roomForwardSecret(base, 'live');
  assert.equal(live.length, 32);
  assert.notDeepEqual(live, await roomForwardSecret(base, 'ttl-60'));
  assert.deepEqual(live, await roomForwardSecret(base, 'live'));
  assert.notDeepEqual(live, await roomForwardSecret(await hkdfKey(random()), 'live'));
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
