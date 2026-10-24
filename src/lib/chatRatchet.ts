import { createCallKeyPair, isCallPublicKey, type CallKeyPair } from './callCrypto';
import { arrayToB64url, b64urlToArray } from './chatCrypto';

// Forward secrecy for rooms without server history. Every member holds an ephemeral P-256 key pair for the session only
// and a sender chain: each message key is HKDF(chain key, "message"), the next chain key HKDF(chain key, "chain"),
// and used keys are wiped. A chain key reaches each member separately, wrapped under
// HKDF(ECDH shared secret || room secret, both identities and the key id), inside the normal signed room channel.

export type EphemeralKeyPair = CallKeyPair;
export type FsMember = { clientId: string; pk: string; pub: string };
export type FsSealed = { type: 'fs'; k: string; n: number; c: string };
export type FsGrant = { to: string; n: number; w: string };
export type FsGrantPayload = { type: 'fs-key'; clientId: string; fs: string; k: string; keys: FsGrant[] };
export type FsSyncPayload = { type: 'chat-sync'; clientId: string; fs: string; to: string; k: string; c: string };

export const ROTATE_AFTER_MESSAGES = 100;
export const ROTATE_AFTER_MS = 10 * 60_000;
export const ORIGIN_WINDOW_MS = 5_000;
export const MAX_SKIP = 1000;
export const MAX_SKIPPED_KEYS = 1000;
export const SKIPPED_KEY_TTL_MS = 10 * 60_000;
export const RETIRED_CHAIN_MS = 30_000;
export const PENDING_TTL_MS = 60_000;
export const MAX_PENDING = 256;
export const MAX_SYNC_ITEMS = 500;
export const MAX_FS_MEMBERS = 64;

const MAX_CHAINS_PER_SENDER = 4;
const MAX_PAIR_BASES = 128;
const REGRANT_INTERVAL_MS = 2_000;
const MAX_INDEX = 2 ** 31 - 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_RE = /^[A-Za-z0-9_-]{16}$/;
const WRAPPED_RE = /^[A-Za-z0-9_-]{80}$/;
const SEALED_RE = /^[A-Za-z0-9_-]+$/;
const LABEL = 'encrypt.click/chat/fs/v1';
const EMPTY = new Uint8Array(0);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const PENDING = Symbol('pending');
export const createEphemeralKeyPair = createCallKeyPair;
export const validEphemeralKey = isCallPublicKey;

export function validKeyId(value: unknown): value is string {
  return typeof value === 'string' && KEY_ID_RE.test(value);
}

export function validIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_INDEX;
}

export function newKeyId(): string {
  return arrayToB64url(crypto.getRandomValues(new Uint8Array(12)));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

class Serial {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => T | Promise<T>): Promise<T> {
    const next = this.tail.then(task);
    this.tail = next.catch(() => {});
    return next;
  }
}

export async function chainStep(chainKey: Uint8Array): Promise<{ messageKey: Uint8Array; next: Uint8Array }> {
  if (chainKey.length !== KEY_BYTES) throw new Error('Invalid chain key');
  const base = await crypto.subtle.importKey('raw', chainKey as BufferSource, 'HKDF', false, ['deriveBits']);
  const derive = async (label: string) => new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: EMPTY, info: encoder.encode(`${LABEL}/${label}`) },
    base,
    KEY_BYTES * 8,
  ));
  return { messageKey: await derive('message'), next: await derive('chain') };
}

async function aesKey(raw: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [usage]);
}

export async function sealWith(raw: Uint8Array, plaintext: Uint8Array, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    await aesKey(raw, 'encrypt'),
    plaintext as BufferSource,
  ));
  return arrayToB64url(concat(iv, sealed));
}

export async function openWith(raw: Uint8Array, sealed: unknown, context: string): Promise<Uint8Array | null> {
  if (typeof sealed !== 'string' || !SEALED_RE.test(sealed)) return null;
  try {
    const bytes = b64urlToArray(sealed);
    if (bytes.length < IV_BYTES + TAG_BYTES) return null;
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES) as BufferSource, additionalData: encoder.encode(context) },
      await aesKey(raw, 'decrypt'),
      bytes.subarray(IV_BYTES) as BufferSource,
    ));
  } catch {
    return null;
  }
}

export function messageContext(channel: string, sender: string, keyId: string, index: number): string {
  return `${LABEL}/message\n${channel}\n${sender}\n${keyId}\n${index}`;
}

const grantContext = (keyId: string, index: number) => `${LABEL}/grant\n${keyId}\n${index}`;
const syncContext = (id: string) => `${LABEL}/sync\n${id}`;

export type PairEnd = { pk: string; pub: string };
export type PairPurpose = 'chain' | 'sync';

export function pairContext(purpose: PairPurpose, channel: string, from: PairEnd, to: PairEnd, id: string): string {
  return `${LABEL}/pair/${purpose}\n${channel}\n${from.pk}\n${from.pub}\n${to.pk}\n${to.pub}\n${id}`;
}

/**
 * Directional keys between this session's ephemeral key and a peer's. The HKDF input is the ECDH shared secret followed by
 * the room secret, so neither a broken key exchange without the password nor the password without the ephemeral keys is enough.
 */
export class PairKeys {
  private bases = new Map<string, Promise<CryptoKey>>();
  private readonly secret: Uint8Array;

  constructor(private readonly keyPair: EphemeralKeyPair, secret: Uint8Array) {
    if (secret.length !== KEY_BYTES) throw new Error('Invalid room secret');
    this.secret = secret.slice();
  }

  private base(peerPub: string): Promise<CryptoKey> {
    const cached = this.bases.get(peerPub);
    if (cached) return cached;
    const base = (async () => {
      if (!validEphemeralKey(peerPub) || peerPub === this.keyPair.publicKey) throw new Error('Invalid peer key');
      const peer = await crypto.subtle.importKey('raw', b64urlToArray(peerPub) as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, this.keyPair.privateKey, 256));
      const ikm = concat(shared, this.secret);
      try {
        return await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
      } finally {
        shared.fill(0);
        ikm.fill(0);
      }
    })();
    base.catch(() => { if (this.bases.get(peerPub) === base) this.bases.delete(peerPub); });
    if (this.bases.size >= MAX_PAIR_BASES) this.bases.delete(this.bases.keys().next().value as string);
    this.bases.set(peerPub, base);
    return base;
  }

  async derive(purpose: PairPurpose, channel: string, from: PairEnd, to: PairEnd, id: string): Promise<Uint8Array> {
    const mine = this.keyPair.publicKey;
    if ((from.pub === mine) === (to.pub === mine)) throw new Error('Not a pair of this session');
    const base = await this.base(from.pub === mine ? to.pub : from.pub);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: EMPTY, info: encoder.encode(pairContext(purpose, channel, from, to, id)) },
      base,
      KEY_BYTES * 8,
    ));
  }

  clear() {
    this.bases.clear();
    this.secret.fill(0);
  }
}

export async function wrapChainKey(wrapKey: Uint8Array, chainKey: Uint8Array, keyId: string, index: number): Promise<string> {
  if (chainKey.length !== KEY_BYTES) throw new Error('Invalid chain key');
  return sealWith(wrapKey, chainKey, grantContext(keyId, index));
}

export async function unwrapChainKey(wrapKey: Uint8Array, wrapped: unknown, keyId: string, index: number): Promise<Uint8Array | null> {
  if (typeof wrapped !== 'string' || !WRAPPED_RE.test(wrapped)) return null;
  const raw = await openWith(wrapKey, wrapped, grantContext(keyId, index));
  return raw?.length === KEY_BYTES ? raw : null;
}

/**
 * This member's sending chain. A chain started at a join or after someone left keeps its first state for a few seconds,
 * so members who were already in the room and answer late can still read from its first message; newcomers never get it.
 */
export class SenderChain {
  readonly keyId = newKeyId();
  readonly given = new Set<string>();
  readonly newcomers = new Set<string>();
  private index = 0;
  private key: Uint8Array | null;
  private origin: { key: Uint8Array; until: number } | null;
  private serial = new Serial();

  constructor(readonly createdAt: number, keepOrigin: boolean) {
    this.key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
    this.origin = keepOrigin ? { key: this.key.slice(), until: createdAt + ORIGIN_WINDOW_MS } : null;
  }

  get used(): number {
    return this.index;
  }

  next(): Promise<{ index: number; messageKey: Uint8Array }> {
    return this.serial.run(async () => {
      if (!this.key || this.index >= MAX_INDEX) throw new Error('Chain closed');
      const { messageKey, next } = await chainStep(this.key);
      this.key.fill(0);
      this.key = next;
      return { index: this.index++, messageKey };
    });
  }

  grant(fromOrigin: boolean, now: number): Promise<{ index: number; key: Uint8Array }> {
    return this.serial.run(() => {
      if (this.origin && now >= this.origin.until) this.dropOrigin();
      if (fromOrigin && this.origin) return { index: 0, key: this.origin.key.slice() };
      if (!this.key) throw new Error('Chain closed');
      return { index: this.index, key: this.key.slice() };
    });
  }

  dropOrigin() {
    this.origin?.key.fill(0);
    this.origin = null;
  }

  wipe(): Promise<void> {
    return this.serial.run(() => {
      this.dropOrigin();
      this.key?.fill(0);
      this.key = null;
    });
  }
}

type ReceiveChain = {
  id: number;
  index: number;
  key: Uint8Array | null;
  retireAt: number;
  skipped: Map<number, { key: Uint8Array; expires: number }>;
  serial: Serial;
};

export type ReceiveLimits = { maxSkip: number; maxSkipped: number; skippedTtlMs: number; retiredMs: number };

/** Receiving chains per sender, with a bounded, expiring store of message keys skipped over for out-of-order delivery. */
export class ReceiveChains {
  private senders = new Map<string, Map<string, ReceiveChain>>();
  private order = new Map<string, { chain: ReceiveChain; index: number }>();
  private ids = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limits: ReceiveLimits = { maxSkip: MAX_SKIP, maxSkipped: MAX_SKIPPED_KEYS, skippedTtlMs: SKIPPED_KEY_TTL_MS, retiredMs: RETIRED_CHAIN_MS },
  ) {}

  get skippedCount(): number {
    return this.order.size;
  }

  has(sender: string, keyId: string): boolean {
    return Boolean(this.senders.get(sender)?.has(keyId));
  }

  /** A sender's newer chain retires the older ones: they stop deriving after a grace period, while skipped keys live on. */
  add(sender: string, keyId: string, index: number, key: Uint8Array): boolean {
    let chains = this.senders.get(sender);
    if (chains?.has(keyId) || !validIndex(index) || key.length !== KEY_BYTES) {
      key.fill(0);
      return false;
    }
    if (!chains) {
      chains = new Map();
      this.senders.set(sender, chains);
    }
    const now = this.now();
    for (const chain of chains.values()) chain.retireAt = Math.min(chain.retireAt, now + this.limits.retiredMs);
    chains.set(keyId, { id: ++this.ids, index, key, retireAt: Infinity, skipped: new Map(), serial: new Serial() });
    while (chains.size > MAX_CHAINS_PER_SENDER) {
      const [oldest, chain] = chains.entries().next().value as [string, ReceiveChain];
      this.wipeChain(chain);
      chains.delete(oldest);
    }
    return true;
  }

  /** The key for one message, used once: a second request for the same index finds nothing. */
  messageKey(sender: string, keyId: string, index: number): Promise<Uint8Array | null> {
    const chain = this.senders.get(sender)?.get(keyId);
    if (!chain || !validIndex(index)) return Promise.resolve(null);
    return chain.serial.run(async () => {
      const now = this.now();
      this.expire(now);
      if (index < chain.index) {
        const hit = chain.skipped.get(index);
        if (!hit) return null;
        chain.skipped.delete(index);
        this.order.delete(`${chain.id}:${index}`);
        return hit.key;
      }
      if (now >= chain.retireAt) {
        chain.key?.fill(0);
        chain.key = null;
      }
      if (!chain.key || index - chain.index > this.limits.maxSkip) return null;
      while (chain.index < index) {
        const skipped = await this.step(chain);
        if (!skipped) return null;
        this.remember(chain, chain.index - 1, skipped, now);
      }
      return this.step(chain);
    });
  }

  private async step(chain: ReceiveChain): Promise<Uint8Array | null> {
    const key = chain.key;
    if (!key) return null;
    const { messageKey, next } = await chainStep(key);
    if (chain.key !== key) {
      messageKey.fill(0);
      next.fill(0);
      return null;
    }
    key.fill(0);
    chain.key = next;
    chain.index++;
    return messageKey;
  }

  private remember(chain: ReceiveChain, index: number, key: Uint8Array, now: number) {
    chain.skipped.set(index, { key, expires: now + this.limits.skippedTtlMs });
    this.order.set(`${chain.id}:${index}`, { chain, index });
    while (this.order.size > this.limits.maxSkipped) {
      const [id, oldest] = this.order.entries().next().value as [string, { chain: ReceiveChain; index: number }];
      oldest.chain.skipped.get(oldest.index)?.key.fill(0);
      oldest.chain.skipped.delete(oldest.index);
      this.order.delete(id);
    }
  }

  private expire(now: number) {
    for (const [id, entry] of this.order) {
      const hit = entry.chain.skipped.get(entry.index);
      if (hit && hit.expires > now) break;
      hit?.key.fill(0);
      entry.chain.skipped.delete(entry.index);
      this.order.delete(id);
    }
  }

  private wipeChain(chain: ReceiveChain) {
    chain.key?.fill(0);
    chain.key = null;
    for (const [index, hit] of chain.skipped) {
      hit.key.fill(0);
      this.order.delete(`${chain.id}:${index}`);
    }
    chain.skipped.clear();
  }

  dropSender(sender: string) {
    for (const chain of this.senders.get(sender)?.values() ?? []) this.wipeChain(chain);
    this.senders.delete(sender);
  }

  clear() {
    for (const sender of [...this.senders.keys()]) this.dropSender(sender);
  }
}

type RosterEntry = FsMember & { confirmed: boolean; regrantAt: number };
type Pending = { sender: string; outer: FsSealed; expires: number };

export type FsSessionOptions = {
  channel: string;
  self: { pk: string; clientId: string };
  secret: Uint8Array;
  keyPair: EphemeralKeyPair;
  send: (payload: FsGrantPayload) => Promise<void>;
  now?: () => number;
};

/**
 * One member's forward secrecy state for one room session: the ephemeral key, its own sending chain, the members it has
 * handed that chain to and the chains it received. Nothing here is ever stored.
 */
export class ForwardSecrecySession {
  readonly publicKey: string;
  private readonly pairs: PairKeys;
  private readonly receive: ReceiveChains;
  private readonly roster = new Map<string, RosterEntry>();
  private readonly pending = new Map<string, Pending[]>();
  private readonly lock = new Serial();
  private readonly now: () => number;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private chain: SenderChain | null = null;
  private closed = false;

  static async create(options: Omit<FsSessionOptions, 'keyPair'>): Promise<ForwardSecrecySession> {
    return new ForwardSecrecySession({ ...options, keyPair: await createEphemeralKeyPair() });
  }

  constructor(private readonly options: FsSessionOptions) {
    this.publicKey = options.keyPair.publicKey;
    this.now = options.now ?? Date.now;
    this.pairs = new PairKeys(options.keyPair, options.secret);
    this.receive = new ReceiveChains(this.now);
  }

  get chainKeyId(): string | null {
    return this.chain?.keyId ?? null;
  }

  private get me(): PairEnd {
    return { pk: this.options.self.pk, pub: this.publicKey };
  }

  private later(ms: number, task: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      task();
    }, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.timers.add(timer);
  }

  private upsert(member: FsMember): RosterEntry | null {
    if (this.closed || member.clientId === this.options.self.clientId || !validEphemeralKey(member.pub) || member.pub === this.publicKey) return null;
    const existing = this.roster.get(member.clientId);
    if (existing && existing.pk !== member.pk) return null;
    if (!existing && this.roster.size >= MAX_FS_MEMBERS) return null;
    const entry = existing ?? { ...member, confirmed: true, regrantAt: 0 };
    if (entry.pub !== member.pub) {
      entry.pub = member.pub;
      this.chain?.given.delete(member.clientId);
    }
    entry.confirmed = true;
    this.roster.set(member.clientId, entry);
    return entry;
  }

  private async startChain(keepOrigin: boolean, distribute: boolean) {
    const previous = this.chain;
    const chain = new SenderChain(this.now(), keepOrigin);
    this.chain = chain;
    if (previous) void previous.wipe();
    if (keepOrigin) this.later(ORIGIN_WINDOW_MS, () => chain.dropOrigin());
    if (distribute) await this.distribute([...this.roster.values()].filter((entry) => entry.confirmed));
  }

  private async distribute(entries: RosterEntry[]) {
    const chain = this.chain;
    if (!chain || !entries.length) return;
    const now = this.now();
    const keys: FsGrant[] = [];
    for (const entry of entries.slice(0, MAX_FS_MEMBERS)) {
      let wrapKey: Uint8Array | null = null;
      let grant: { index: number; key: Uint8Array } | null = null;
      try {
        grant = await chain.grant(!chain.newcomers.has(entry.clientId), now);
        wrapKey = await this.pairs.derive('chain', this.options.channel, this.me, entry, chain.keyId);
        keys.push({ to: entry.clientId, n: grant.index, w: await wrapChainKey(wrapKey, grant.key, chain.keyId, grant.index) });
        chain.given.add(entry.clientId);
      } catch {
      } finally {
        grant?.key.fill(0);
        wrapKey?.fill(0);
      }
    }
    if (keys.length && !this.closed) await this.options.send({ type: 'fs-key', clientId: this.options.self.clientId, fs: this.publicKey, k: chain.keyId, keys });
  }

  /** A verified newcomer gets the chain as it stands now, so nothing sent before it arrived can be read with it. */
  memberJoined(member: FsMember): Promise<void> {
    return this.lock.run(async () => {
      const entry = this.upsert(member);
      if (!entry || !this.chain) return;
      this.chain.newcomers.add(entry.clientId);
      this.chain.given.delete(entry.clientId);
      await this.distribute([entry]);
    });
  }

  /** A member who answered a verify, answered the roll call or sent its own chain. */
  memberSeen(member: FsMember): Promise<void> {
    return this.lock.run(async () => {
      const entry = this.upsert(member);
      if (!entry || !this.chain || this.chain.given.has(entry.clientId)) return;
      await this.distribute([entry]);
    });
  }

  memberWants(member: FsMember): Promise<void> {
    return this.lock.run(async () => {
      const entry = this.upsert(member);
      const now = this.now();
      if (!entry || !this.chain || now < entry.regrantAt) return;
      entry.regrantAt = now + REGRANT_INTERVAL_MS;
      await this.distribute([entry]);
    });
  }

  /** Someone left: move to a chain nobody holds yet and hand it only to members who answer the roll call that follows. */
  memberLeft(): Promise<void> {
    return this.lock.run(async () => {
      for (const [id, entry] of this.roster) {
        if (!entry.confirmed) this.roster.delete(id);
        else entry.confirmed = false;
      }
      if (this.chain) await this.startChain(true, false);
    });
  }

  /** This browser's connection dropped and grants may have been lost: start a fresh chain for whoever answers the next verify. */
  reconnected(): Promise<void> {
    return this.lock.run(() => {
      void this.chain?.wipe();
      this.chain = null;
      for (const entry of this.roster.values()) entry.confirmed = false;
    });
  }

  seal(inner: string): Promise<FsSealed> {
    return this.lock.run(async () => {
      if (this.closed) throw new Error('Session closed');
      const now = this.now();
      if (!this.chain) await this.startChain(true, true);
      else if (this.chain.used >= ROTATE_AFTER_MESSAGES || now - this.chain.createdAt >= ROTATE_AFTER_MS) await this.startChain(false, true);
      const chain = this.chain!;
      const { index, messageKey } = await chain.next();
      try {
        const c = await sealWith(messageKey, encoder.encode(inner), messageContext(this.options.channel, this.options.self.pk, chain.keyId, index));
        return { type: 'fs', k: chain.keyId, n: index, c };
      } finally {
        messageKey.fill(0);
      }
    });
  }

  /** The inner payload, PENDING while the sender's chain has not arrived yet, or null when it cannot be opened. */
  async open(sender: string, outer: unknown): Promise<string | typeof PENDING | null> {
    if (this.closed || !outer || typeof outer !== 'object') return null;
    const { k, n, c } = outer as Record<string, unknown>;
    if (!validKeyId(k) || !validIndex(n) || typeof c !== 'string') return null;
    if (!this.receive.has(sender, k)) {
      this.hold({ sender, outer: { type: 'fs', k, n, c }, expires: this.now() + PENDING_TTL_MS });
      return PENDING;
    }
    const key = await this.receive.messageKey(sender, k, n);
    if (!key) return null;
    try {
      const plain = await openWith(key, c, messageContext(this.options.channel, sender, k, n));
      return plain ? decoder.decode(plain) : null;
    } finally {
      key.fill(0);
    }
  }

  private hold(item: Pending) {
    this.prunePending();
    let count = 0;
    for (const list of this.pending.values()) count += list.length;
    if (count >= MAX_PENDING) return;
    const id = `${item.sender}\n${item.outer.k}`;
    this.pending.set(id, [...(this.pending.get(id) ?? []), item]);
  }

  private prunePending() {
    const now = this.now();
    for (const [id, list] of this.pending) {
      const alive = list.filter((item) => item.expires > now);
      if (alive.length) this.pending.set(id, alive);
      else this.pending.delete(id);
    }
  }

  /** Senders whose messages are waiting for a chain key. */
  wanted(): string[] {
    this.prunePending();
    return [...new Set([...this.pending.values()].flat().map((item) => item.sender))];
  }

  /** Takes a chain key addressed to this member and returns the messages that were waiting for it, oldest first. */
  async acceptGrant(sender: string, payload: unknown): Promise<{ sender: string; outer: FsSealed }[]> {
    if (this.closed || !payload || typeof payload !== 'object') return [];
    const { fs, k, keys } = payload as Record<string, unknown>;
    if (!validEphemeralKey(fs) || fs === this.publicKey || !validKeyId(k) || !Array.isArray(keys) || keys.length > MAX_FS_MEMBERS) return [];
    const entry = keys.find((item): item is FsGrant => Boolean(item) && typeof item === 'object' && (item as FsGrant).to === this.options.self.clientId);
    if (!entry || !validIndex(entry.n) || this.receive.has(sender, k)) return [];
    let wrapKey: Uint8Array;
    try {
      wrapKey = await this.pairs.derive('chain', this.options.channel, { pk: sender, pub: fs }, this.me, k);
    } catch {
      return [];
    }
    const chainKey = await unwrapChainKey(wrapKey, entry.w, k, entry.n);
    wrapKey.fill(0);
    if (!chainKey || !this.receive.add(sender, k, entry.n, chainKey)) return [];
    const id = `${sender}\n${k}`;
    const now = this.now();
    const released = (this.pending.get(id) ?? []).filter((item) => item.expires > now).sort((a, b) => a.outer.n - b.outer.n);
    this.pending.delete(id);
    return released.map(({ sender: from, outer }) => ({ sender: from, outer }));
  }

  /** History handed to one newcomer, sealed for that member alone under a fresh pairwise key. */
  async sealSync(to: FsMember, items: string[]): Promise<FsSyncPayload> {
    if (items.length > MAX_SYNC_ITEMS) throw new Error('Too many items');
    const k = newKeyId();
    const key = await this.pairs.derive('sync', this.options.channel, this.me, to, k);
    try {
      return { type: 'chat-sync', clientId: this.options.self.clientId, fs: this.publicKey, to: to.clientId, k, c: await sealWith(key, encoder.encode(JSON.stringify(items)), syncContext(k)) };
    } finally {
      key.fill(0);
    }
  }

  async openSync(sender: string, payload: unknown): Promise<string[] | null> {
    if (this.closed || !payload || typeof payload !== 'object') return null;
    const { fs, to, k, c } = payload as Record<string, unknown>;
    if (to !== this.options.self.clientId || !validEphemeralKey(fs) || fs === this.publicKey || !validKeyId(k)) return null;
    let key: Uint8Array;
    try {
      key = await this.pairs.derive('sync', this.options.channel, { pk: sender, pub: fs }, this.me, k);
    } catch {
      return null;
    }
    const plain = await openWith(key, c, syncContext(k));
    key.fill(0);
    if (!plain) return null;
    try {
      const items = JSON.parse(decoder.decode(plain));
      return Array.isArray(items) && items.length <= MAX_SYNC_ITEMS && items.every((item) => typeof item === 'string') ? items : null;
    } catch {
      return null;
    }
  }

  destroy() {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    void this.chain?.wipe();
    this.chain = null;
    this.receive.clear();
    this.pairs.clear();
    this.roster.clear();
    this.pending.clear();
  }
}
