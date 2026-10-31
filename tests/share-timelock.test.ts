import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decrypt, encrypt } from '../src/lib/aesGcm';
import { decryptData, encryptData } from '../src/lib/ghost/crypto';
import { openPassword, sealPassword } from '../src/lib/passwordEnvelope';
import { formatShareFragment, parseShareFragment } from '../src/lib/shareLink';
import { DRAND_CHAIN, TIME_SECRET_BYTES, roundAt, roundTime } from '../src/lib/timelock';

const FAST = { memory: 8192, iterations: 1, parallelism: 1 };
const secret = () => crypto.getRandomValues(new Uint8Array(TIME_SECRET_BYTES));
const data = new TextEncoder().encode('meet at noon');

test('a time-locked envelope needs both the password and the time secret', async () => {
  const timeSecret = secret();
  const sealed = await sealPassword(data, 'correct horse', { params: FAST, timeSecret });
  assert.deepEqual(await openPassword(sealed, 'correct horse', timeSecret), data);
  await assert.rejects(openPassword(sealed, 'correct horse'), /Wrong password/);
  await assert.rejects(openPassword(sealed, 'correct horse', secret()), /Wrong password/);
  await assert.rejects(openPassword(sealed, 'wrong horse', timeSecret), /Wrong password/);

  const plain = await sealPassword(data, 'correct horse', { params: FAST });
  assert.deepEqual(await openPassword(plain, 'correct horse'), data);
  await assert.rejects(openPassword(plain, 'correct horse', timeSecret), /Wrong password/);
  assert.deepEqual(sealed.subarray(0, 12), plain.subarray(0, 12));

  await assert.rejects(sealPassword(data, 'correct horse', { params: FAST, timeSecret: new Uint8Array(16) }), /time secret/);
});

test('link payloads and uploaded files carry the time secret through their own helpers', async () => {
  const timeSecret = secret();
  const payload = await encrypt('{"v":1}', 'correct horse', undefined, timeSecret);
  assert.equal(await decrypt(payload, 'correct horse', timeSecret), '{"v":1}');
  await assert.rejects(decrypt(payload, 'correct horse'));

  const file = await encryptData(data, 'correct horse', 'note.txt', timeSecret);
  assert.deepEqual(await decryptData(file, 'correct horse', timeSecret), { data, name: 'note.txt' });
  await assert.rejects(decryptData(file, 'correct horse'));
});

test('time-locked links carry the round and the locked secret next to the payload', () => {
  const lock = { round: 12_345_678, ciphertext: crypto.getRandomValues(new Uint8Array(301)) };
  const fragment = formatShareFragment({ payload: 'abc', expires: 1_800_000_000, burn: true, lock });
  assert.match(fragment, /^v=2&x=1800000000&b=1&r=12345678&l=[A-Za-z0-9_-]+&p=abc$/);
  assert.deepEqual(parseShareFragment(fragment), { payload: 'abc', expires: 1_800_000_000, burn: true, lock });
  const inline = formatShareFragment({ payload: 'xyz', lock });
  assert.deepEqual(parseShareFragment(inline), { payload: 'xyz', lock });

  const l = fragment.match(/l=([^&]+)/)![1];
  for (const bad of [`v=2&r=5&p=abc`, `v=2&l=${l}&p=abc`, `v=2&r=0&l=${l}&p=abc`, `v=2&r=05&l=${l}&p=abc`, `v=2&r=5&l=a&p=abc`, `v=2&r=5&l=${'A'.repeat(6000)}&p=abc`]) {
    assert.equal(parseShareFragment(bad), null, bad.slice(0, 40));
  }
  assert.throws(() => formatShareFragment({ payload: 'abc', lock: { round: 0, ciphertext: new Uint8Array(4) } }));
});

test('rounds follow the drand quicknet clock', () => {
  const at = Date.UTC(2026, 10, 1, 9, 30, 1);
  const round = roundAt(at);
  assert.ok(roundTime(round) <= at && at < roundTime(round + 1));
  assert.equal(roundTime(1), DRAND_CHAIN.genesis * 1000);
  assert.equal(roundAt(DRAND_CHAIN.genesis * 1000), 1);
  assert.equal(roundTime(round + 1) - roundTime(round), DRAND_CHAIN.period * 1000);
});

test('the locked secret is the bare age file for the chosen round', async () => {
  const { lockTimeSecret } = await import('../src/lib/timelock');
  const original = globalThis.fetch;
  const info = {
    public_key: DRAND_CHAIN.publicKey, period: DRAND_CHAIN.period, genesis_time: DRAND_CHAIN.genesis, hash: DRAND_CHAIN.chainHash,
    groupHash: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e', schemeID: 'bls-unchained-g1-rfc9380', metadata: { beaconID: 'quicknet' },
  };
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(JSON.stringify(info), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const unlock = Date.now() + 3600_000;
    const { secret, lock } = await lockTimeSecret(unlock);
    assert.equal(secret.length, TIME_SECRET_BYTES);
    assert.equal(lock.round, roundAt(unlock));
    const header = new TextDecoder().decode(lock.ciphertext.subarray(0, 120));
    assert.ok(header.startsWith(`age-encryption.org/v1\n-> tlock ${lock.round} ${DRAND_CHAIN.chainHash}\n`), header);
    assert.ok(requested.every(url => url.startsWith(`/api/drand/${DRAND_CHAIN.chainHash}/`)), requested.join());
  } finally {
    globalThis.fetch = original;
  }
});
