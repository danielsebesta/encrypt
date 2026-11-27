import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huffmanPack, huffmanUnpack } from '../src/lib/chatCipher/huffman';
import { packContent, unpackContent } from '../src/lib/chatCipher/compress';
import { COVER_LANGS, type CoverLang } from '../src/lib/chatCipher/coverTable';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

test('huffman round-trips every language, rare bytes, emoji and long text', () => {
  const samples: Array<[CoverLang, string]> = [
    ['en', 'meet me at the old station at nine, come alone'],
    ['cs', 'tak v sedm u stareho nadrazi, sam, a nezapomen Kabat'],
    ['de', 'treff mich um sieben am alten Bahnhof, allein'],
    ['pl', 'spotkajmy się o siódmej przy starej stacji, sam'],
    ['en', '🚆 ok 👍 ' + 'naïve résumé'.repeat(4)],
    ['fr', 'rendez-vous à sept heures à la vieille gare, seul'],
  ];
  for (const [lang, text] of samples) {
    const data = new TextEncoder().encode(text);
    const packed = huffmanPack(data, lang);
    if (!packed) continue;
    const back = huffmanUnpack(packed, lang);
    assert.equal(new TextDecoder().decode(back), text, `${lang}: ${text.slice(0, 24)}`);
  }
});

test('huffman survives bytes that never appear in the corpus', () => {
  const rand = seeded(31);
  const keys = Uint8Array.from({ length: 400 }, (_, i) => (i < 380 ? 0x61 + (i % 26) : Math.floor(rand() * 256)));
  for (const lang of COVER_LANGS) {
    const packed = huffmanPack(keys, lang);
    if (!packed) continue;
    const back = huffmanUnpack(packed, lang);
    assert.deepEqual(back, keys, lang);
  }
});

test('huffman refuses empty, oversized and malformed payloads', () => {
  assert.equal(huffmanPack(new Uint8Array(0), 'en'), null);
  assert.equal(huffmanPack(new Uint8Array(70000), 'en'), null);
  assert.throws(() => huffmanUnpack(new Uint8Array(0), 'en'), /decompress/);
  assert.throws(() => huffmanUnpack(new Uint8Array([0x40]), 'en'), /decompress/);
  const packed = huffmanPack(new TextEncoder().encode('hello world, plans changed'), 'en')!;
  const genuine = huffmanUnpack(packed, 'en');
  assert.equal(new TextDecoder().decode(genuine), 'hello world, plans changed');
  assert.ok(packed.length < genuine.length);
});

test('content picks the smallest packing: raw, deflate or static huffman', async () => {
  assert.equal((await packContent('', 'en'))[0], 0);
  const short = await packContent('meet me at the old station at nine, come alone', 'en');
  assert.equal(short[0], 2 + COVER_LANGS.indexOf('en'), `expected en huffman, got ${short[0]}`);
  assert.ok(short.length < new TextEncoder().encode('meet me at the old station at nine, come alone').length);
  assert.equal(await unpackContent(short), 'meet me at the old station at nine, come alone');

  const repeated = await packContent('stejna zprava '.repeat(40), 'cs');
  assert.equal(repeated[0], 1, `expected deflate, got ${repeated[0]}`);
  assert.equal(await unpackContent(repeated), 'stejna zprava '.repeat(40));

  for (const text of ['', 'a', 'ok', '🚆 👍', 'tak v sedm u stareho nadrazi, sam 🚆', 'naïve résumé']) {
    for (const lang of COVER_LANGS) {
      assert.equal(await unpackContent(await packContent(text, lang)), text, `${lang}: ${text}`);
    }
  }
});

test('sealed content names its own language model, whatever cover carries it', async () => {
  const czech = 'tak v sedm u stareho nadrazi, sam';
  for (const packLang of COVER_LANGS) {
    const content = await packContent(czech, packLang);
    const flag = content[0];
    if (flag >= 2) assert.equal(flag, 2 + COVER_LANGS.indexOf(packLang), `${packLang}: expected its own model id`);
    assert.equal(await unpackContent(content), czech);
    assert.equal(await unpackContent(await packContent('meet me at the old station', packLang)), 'meet me at the old station');
  }
  await assert.rejects(() => unpackContent(new Uint8Array([2 + COVER_LANGS.length, 0])), /Unsupported/);
  await assert.rejects(() => unpackContent(new Uint8Array([255, 0])), /Unsupported/);
});
