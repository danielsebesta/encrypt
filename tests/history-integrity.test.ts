import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryChains, loadChainState, saveChainState, validHead } from '../src/lib/chatIntegrity';
import { chainHash, generateSigningIdentity, signPayload } from '../src/lib/chatCrypto';
import { stampPayload, validPayload } from '../src/lib/chatProtocol';

const A = 'A'.repeat(43);
const B = 'B'.repeat(43);
const h = (n: number, fork = '') => `${String(n).padStart(4, '0')}${fork}`.padEnd(43, 'h');

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
  };
}

test('a sender chain read in order raises nothing, and repeats of a payload already seen are ignored', () => {
  const chains = new HistoryChains();
  assert.equal(chains.observe(A, { n: 1, h: h(1), ph: '', seq: 10 }), null);
  assert.equal(chains.observe(A, { n: 2, h: h(2), ph: h(1), seq: 11 }), null);
  assert.equal(chains.observe(A, { n: 3, h: h(3), ph: h(2), seq: 15 }), null);
  assert.equal(chains.observe(A, { n: 2, h: h(2), ph: h(1), seq: 11 }), null);
  assert.deepEqual(chains.head(A), { n: 3, h: h(3) });
  assert.equal(chains.observe(B, { n: 40, h: h(40), ph: h(39), seq: 16 }), null);
});

test('skipped counters are a gap, an older payload placed after a newer one is a reorder, two payloads in one place are a fork', () => {
  const chains = new HistoryChains();
  chains.observe(A, { n: 1, h: h(1), ph: '', seq: 1 });
  assert.equal(chains.observe(A, { n: 3, h: h(3), ph: h(2), seq: 3 }), 'gap');
  assert.equal(chains.observe(A, { n: 2, h: h(2), ph: h(1), seq: 4 }), 'reorder');
  assert.equal(chains.observe(A, { n: 2, h: h(2), ph: h(1), seq: 2 }), null);
  assert.equal(chains.observe(A, { n: 3, h: h(3, 'x'), ph: h(2), seq: 5 }), 'fork');
  assert.equal(chains.observe(A, { n: 4, h: h(4), ph: h(3, 'x'), seq: 6 }), 'fork');
  assert.equal(chains.observe(A, { n: 5, h: h(5), ph: h(4), seq: 7 }), null);
});

test('a relaxed first payload may skip ahead after the server trimmed history, later ones may not', () => {
  const chains = new HistoryChains({ [A]: { n: 3, h: h(3), recent: [[3, h(3)]] } });
  assert.equal(chains.observe(A, { n: 50, h: h(50), ph: h(49), seq: 900 }, true), null);
  assert.equal(chains.observe(A, { n: 52, h: h(52), ph: h(51), seq: 901 }), 'gap');
});

test('a head announced beyond what arrived shows held-back messages, a different hash at the same place a fork', () => {
  const chains = new HistoryChains();
  chains.observe(A, { n: 1, h: h(1), ph: '' });
  chains.observe(A, { n: 2, h: h(2), ph: h(1) });
  assert.equal(chains.announced(A, { n: 2, h: h(2) }), null);
  assert.equal(chains.announced(A, { n: 1, h: h(1) }), null);
  assert.equal(chains.announced(A, { n: 4, h: h(4) }), 'truncated');
  assert.equal(chains.announced(A, { n: 2, h: h(2, 'x') }), 'fork');
  assert.equal(chains.announced(B, { n: 9, h: h(9) }), null);
  assert.equal(validHead({ n: 0, h: h(0) }), false);
  assert.equal(validHead({ n: 1, h: 'short' }), false);
});

test('chain state survives a reload and two tabs writing at once keep the longer chain', () => {
  const storage = memoryStorage();
  const one = new HistoryChains();
  one.observe(A, { n: 5, h: h(5), ph: h(4), seq: 20 });
  saveChainState(storage, 'room', { n: 2, h: h(2) }, one);
  const other = new HistoryChains();
  other.observe(A, { n: 3, h: h(3), ph: h(2), seq: 12 });
  other.observe(B, { n: 1, h: h(1), ph: '' });
  saveChainState(storage, 'room', { n: 1, h: h(1) }, other);
  const loaded = loadChainState(storage, 'room');
  assert.deepEqual(loaded.mine, { n: 2, h: h(2) });
  const reloaded = new HistoryChains(loaded.senders);
  assert.deepEqual(reloaded.head(A), { n: 5, h: h(5) });
  assert.deepEqual(reloaded.head(B), { n: 1, h: h(1) });
  assert.equal(reloaded.observe(A, { n: 6, h: h(6), ph: h(5), seq: 21 }), null);
  storage.setItem('broken', '{not json');
  assert.deepEqual(loadChainState(storage, 'broken'), { mine: null, senders: {} });
});

test('the chain hash covers every signed field but neither signature, and signed chain fields must come as a pair', async () => {
  const identity = await generateSigningIdentity();
  const signed = JSON.parse(await signPayload(identity, stampPayload(JSON.stringify({ type: 'chat-message', id: 'a', text: 'hi', _n: 1, _ph: '' }), 'room')));
  const hash = await chainHash(signed);
  assert.match(hash, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await chainHash({ ...signed, _sig: 'x', _pq: 'y' }), hash);
  assert.notEqual(await chainHash({ ...signed, text: 'ho' }), hash);
  assert.notEqual(await chainHash({ ...signed, _n: 2 }), hash);
  assert.equal(validPayload(signed, 'room', true), true);
  assert.equal(validPayload({ ...signed, _ph: undefined }, 'room', true), false);
  assert.equal(validPayload({ ...signed, _n: 0 }, 'room', true), false);
  assert.equal(validPayload({ ...signed, _ph: 'nope' }, 'room', true), false);
  assert.equal(validPayload({ ...signed, _n: 2, _ph: hash }, 'room', true), true);
});
