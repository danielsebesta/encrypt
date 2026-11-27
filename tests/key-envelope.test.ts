import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrayToB64url } from '../src/lib/chatCrypto';
import { encryptDataWithKey, decryptData } from '../src/lib/ghost/crypto';
import { KEY_ENVELOPE_BYTES, KEY_ENVELOPE_MAGIC, isKeyEnvelope, openWithKey, sealWithKey } from '../src/lib/keyEnvelope';
import { openPasswordWithSurplus, preparePasswordOpen, sealPassword } from '../src/lib/passwordEnvelope';

const fileKey = () => crypto.getRandomValues(new Uint8Array(KEY_ENVELOPE_BYTES));

test('raw-key envelopes round trip multi-part payloads', async () => {
  const key = fileKey();
  const sealed = await sealWithKey([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])], key);
  assert.ok(isKeyEnvelope(sealed));
  assert.deepEqual(KEY_ENVELOPE_MAGIC, sealed.subarray(0, KEY_ENVELOPE_MAGIC.length));
  assert.deepEqual(await openWithKey(sealed, key), new Uint8Array([1, 2, 3, 4, 5, 6]));
});

test('a second seal under the same key never repeats the salt or the ciphertext', async () => {
  const key = fileKey();
  const a = await sealWithKey(new Uint8Array(64).fill(7), key);
  const b = await sealWithKey(new Uint8Array(64).fill(7), key);
  assert.equal(a.length, b.length);
  assert.notDeepEqual(a.subarray(5), b.subarray(5));
});

test('wrong, short and oversized keys are refused before any open', async () => {
  const key = fileKey();
  const sealed = await sealWithKey(new Uint8Array([9]), key);
  await assert.rejects(openWithKey(sealed, fileKey()));
  await assert.rejects(openWithKey(sealed, key.subarray(0, 31)), /Invalid key/);
  await assert.rejects(sealWithKey(new Uint8Array([1]), crypto.getRandomValues(new Uint8Array(33))), /Invalid key/);
  assert.equal(isKeyEnvelope(new Uint8Array([69, 67, 80, 51, 1])), false);
});

test('chat files seal under their random key and open on the shared decrypt path', async () => {
  const data = crypto.getRandomValues(new Uint8Array(2048));
  const key = fileKey();
  const sealed = await encryptDataWithKey(data, key, 'photo.png');
  assert.ok(isKeyEnvelope(sealed));
  const keyB64 = arrayToB64url(key);
  assert.deepEqual(await decryptData(sealed.slice(), keyB64), { data, name: 'photo.png' });
  await assert.rejects(decryptData(sealed.slice(), arrayToB64url(fileKey())));
});

test('a human password can never reach the raw-key path', async () => {
  const sealed = await encryptDataWithKey(new TextEncoder().encode('file body'), fileKey(), 'a.bin');
  await assert.rejects(decryptData(sealed.slice(), 'correct horse'), /Invalid file key/);
  await assert.rejects(decryptData(sealed.slice(), 'p@ssw0rd!'), /Invalid file key/);
});

test('an empty content still opens', async () => {
  const key = fileKey();
  const sealed = await sealWithKey(new Uint8Array(0), key);
  assert.equal(sealed.length, 29);
  assert.deepEqual(await openWithKey(sealed, key), new Uint8Array(0));
});

test('preparePasswordOpen derives once and opens candidate ends against the derived key', async () => {
  const message = new TextEncoder().encode('manifest body of one chunked file');
  const sealed = await sealPassword(message, 'correct horse');
  const prepared = await preparePasswordOpen(sealed, 'correct horse');
  assert.equal(prepared.compact, false);
  assert.deepEqual(await prepared.open(sealed.length), message);
  await assert.rejects(prepared.open(sealed.length - 1));
  await assert.rejects(prepared.open(76));
  await assert.rejects(preparePasswordOpen(sealed, 'wrong horse'), /Wrong password/);
});

test('the surplus window still opens every carried envelope and stops beyond it', async () => {
  for (const surplus of [0, 1, 5, 16, 40, 63]) {
    const message = new TextEncoder().encode('a message that stays itself');
    const sealed = await sealPassword(message, 'pw');
    const carried = new Uint8Array(sealed.length + surplus);
    carried.set(sealed);
    assert.deepEqual(await openPasswordWithSurplus(carried, 'pw'), message, `full +${surplus}`);
  }
  const compact = await sealPassword(new TextEncoder().encode('a compact one'), 'pw', { compact: true });
  for (const surplus of [0, 1, 5, 16, 40]) {
    const carried = new Uint8Array(compact.length + surplus);
    carried.set(compact);
    assert.deepEqual(await openPasswordWithSurplus(carried, 'pw'), new TextEncoder().encode('a compact one'), `compact +${surplus}`);
  }
  const far = new Uint8Array(compact.length + 200);
  far.set(compact);
  await assert.rejects(openPasswordWithSurplus(far, 'pw'), /Wrong password/);
  await assert.rejects(openPasswordWithSurplus(far, 'wrong'), /Wrong password/);
});
