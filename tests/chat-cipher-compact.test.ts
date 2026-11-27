import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCoverTable } from '../src/lib/chatCipher/tableCodec';
import { COVER_TABLE_URL, coverCodecFor } from '../src/lib/chatCipher/coverTable';
import { packContent, unpackContent } from '../src/lib/chatCipher/compress';
import {
  openPasswordWithSurplus,
  restoreFixedHeader,
  sealPassword,
  sealedCompactLength,
  stripFixedHeader,
} from '../src/lib/passwordEnvelope';

const packed = readFileSync(new URL(`../public${COVER_TABLE_URL}`, import.meta.url));
const codec = coverCodecFor('cs', parseCoverTable(gunzipSync(packed)));

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

async function compactSealed(message: string, password: string) {
  const content = await packContent(message, 'cs');
  const sealed = await sealPassword(content, password, { compact: true });
  return { content, sealed, body: stripFixedHeader(sealed, true) };
}

test('a compact envelope crosses the cover and comes back', async () => {
  const message = 'meet me at the old station at nine, come alone';
  const { body } = await compactSealed(message, 'correct horse');
  const rand = seeded(9);
  const cover = await codec.encode(body, rand);
  const decoded = await codec.decode(cover);
  const sealed = restoreFixedHeader(decoded, true);
  assert.equal(await unpackContent(await openPasswordWithSurplus(sealed, 'correct horse')), message);
  await assert.rejects(openPasswordWithSurplus(sealed, 'wrong horse'), /Wrong password/);
});

test('the compact envelope saves more than half of the full one', async () => {
  const message = 'meet me at the old station at nine, come alone';
  const { content, sealed, body } = await compactSealed(message, 'pw');
  assert.equal(sealed.length, sealedCompactLength(content.length));
  assert.equal(body.length, sealed.length - 12);
  const legacy = await sealPassword(new TextEncoder().encode(message), 'pw');
  assert.ok(body.length <= legacy.length - 12 - 55, `compact ${body.length} vs legacy ${legacy.length - 12}`);
});

test('an empty message crosses with the smallest possible floor', async () => {
  const { sealed, body } = await compactSealed('', 'pw');
  assert.equal(sealed.length, 29);
  assert.equal(body.length, 17);
  const cover = await codec.encode(body, seeded(3));
  assert.equal(await unpackContent(await openPasswordWithSurplus(restoreFixedHeader(await codec.decode(cover), true), 'pw')), '');
});

test('surplus bytes after the envelope are ignored at every size', async () => {
  for (const surplus of [0, 1, 2, 5, 16, 40]) {
    const message = 'kratsi zprava na zkusku, priloz za ni balast';
    const { sealed } = await compactSealed(message, 'pw');
    const carried = new Uint8Array(sealed.length + surplus);
    carried.set(sealed);
    assert.equal(
      await unpackContent(await openPasswordWithSurplus(carried, 'pw')),
      message,
      `surplus ${surplus}`,
    );
  }
});

test('covers sealed the old way are refused', async () => {
  const legacySealed = await sealPassword(new TextEncoder().encode('older message'), 'pw');
  const body = stripFixedHeader(legacySealed);
  const cover = await codec.encode(body, seeded(21));
  const decoded = await codec.decode(cover);
  await assert.rejects(openPasswordWithSurplus(restoreFixedHeader(decoded, true), 'pw'), /Wrong password/);
});

test('an altered compact cover never opens', async () => {
  const { sealed } = await compactSealed('tajemstvi', 'pw');
  const body = stripFixedHeader(sealed, true);
  const rand = seeded(5);
  const text = await codec.encode(body, rand);
  const words = text.split(' ');
  let altered: Uint8Array | null = null;
  for (let at = Math.floor(words.length / 2); at < words.length && !altered; at++) {
    const copy = [...words];
    copy[at] = copy[at] === 'a' ? 'to' : 'a';
    const decoded = await codec.decode(copy.join(' ')).catch(() => null);
    if (decoded && decoded.subarray(0, body.length).some((byte, i) => byte !== body[i])) altered = decoded;
  }
  assert.ok(altered);
  await assert.rejects(openPasswordWithSurplus(restoreFixedHeader(altered, true), 'pw'), /Wrong password|decrypted|Invalid/);
});
