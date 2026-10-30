import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createCoverCodec, parseCoverTable } from '../src/lib/chatCipher/tableCodec';
import { PACKS } from '../src/lib/chatCipher/packs';
import { chatCipherErrorKey } from '../src/lib/chatCipher/errors';
import { foldWord } from '../src/lib/chatNoise';
import { openPasswordWithSurplus, restoreFixedHeader, sealPassword, stripFixedHeader } from '../src/lib/passwordEnvelope';
import { ARGON2_V3 } from '../src/lib/kdf';

const packed = readFileSync(new URL('../public/chat-cipher/cs/2/table.bin', import.meta.url));
const table = parseCoverTable(gunzipSync(packed));
const codec = createCoverCodec(table);

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

const bytes = (length: number, rand: () => number) => Uint8Array.from({ length }, () => Math.floor(rand() * 256));

test('the table on disk is the one the pack manifest pins', () => {
  const file = PACKS.cs.files[0]!;
  assert.equal(createHash('sha256').update(packed).digest('hex'), file.sha256);
  assert.equal(packed.length, file.bytes);
  assert.equal(table.words.length, PACKS.cs.vocabSize);
});

test('words fold to unique spellings and leave out the banned list', () => {
  const folded = table.words.slice(2).map(foldWord);
  assert.ok(folded.every(Boolean));
  assert.equal(new Set(folded).size, folded.length);
  for (const word of ['negr', 'kunda', 'teplous', 'sebevrazda', 'hitler']) assert.ok(!folded.includes(word), word);
});

test('every payload survives rendering: accents, capitals, marks and typos', async () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rand = seeded(seed);
    const data = bytes(1 + Math.floor(rand() * 120), rand);
    const text = await codec.encode(data, rand);
    const back = await codec.decode(text);
    assert.deepEqual(back.subarray(0, data.length), data, `seed ${seed}: ${text}`);
    assert.ok(back.length - data.length <= 96, `seed ${seed}: ${back.length - data.length} surplus bytes`);
  }
});

test('covers survive what chat apps and people do to them', async () => {
  const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const edits: ((text: string) => string)[] = [
    text => fold(text).toUpperCase(),
    text => text.toLowerCase(),
    text => text.replace(/, /g, '\n').replace(/\. /g, '.\r\n\r\n'),
    text => `  ${text.replace(/ /g, '  ')}\n\n`,
    text => text.replace(/\.\.\./g, '…'),
  ];
  for (let seed = 1; seed <= 60; seed++) {
    const rand = seeded(seed * 7919);
    const data = bytes(84, rand);
    const text = await codec.encode(data, rand);
    for (const edit of edits) {
      assert.deepEqual((await codec.decode(edit(text))).subarray(0, 84), data, `seed ${seed}: ${edit(text)}`);
    }
  }
});

test('covers of the same size do not open alike', async () => {
  const openings = new Set<string>();
  const rand = seeded(11);
  for (let i = 0; i < 200; i++) {
    const tokens = await codec.chooseWords(bytes(84, rand), rand);
    openings.add(tokens.slice(0, 6).join(','));
  }
  assert.ok(openings.size >= 180, `${openings.size} distinct openings`);
});

test('this cover must decode forever, or old messages are lost', async () => {
  const cover = 'tak jsem se dívala na seriál, a on se na mě podíval a řekl že by to byla sranda. a pořád mi to nejede. a pořád mi to nefunguje, takže jsem šla do toho obchodu co je je to na prd, a když už budete tam tak se klidně ptejte, ale hele. tak jsem se díval na ten film co jsi mi říkal. a musím ti říct že to je otrava ale je ta za';
  const back = await codec.decode(cover);
  assert.equal(Buffer.from(back.subarray(0, 24)).toString('hex'), '050b09a9a57b9fc42af80b2abc4498d2ff1b5043aad54a87');
});

test('foreign text is reported as the wrong language', async () => {
  await assert.rejects(codec.decode('Kxqzzv wvvqqj ppqqxx zzqqvv xxyyzz'), error => {
    assert.equal(chatCipherErrorKey(error), 'tools.chatCipher.errorCoverMismatch');
    return true;
  });
  await assert.rejects(codec.decode(' ,.!? '), error => {
    assert.equal(chatCipherErrorKey(error), 'tools.chatCipher.errorCoverCorrupt');
    return true;
  });
});

test('a sealed message crosses the cover without any constant bytes', async () => {
  const message = new TextEncoder().encode('schůzka v sedm');
  const sealed = await sealPassword(message, 'correct horse');
  const body = stripFixedHeader(sealed);
  assert.equal(body.length, sealed.length - 12);
  const text = await codec.encode(body);
  const restored = restoreFixedHeader(await codec.decode(text));
  assert.deepEqual(restored.subarray(0, sealed.length), sealed);
  assert.deepEqual(await openPasswordWithSurplus(restored, 'correct horse'), message);
  await assert.rejects(openPasswordWithSurplus(restored, 'wrong horse'), /Wrong password/);
});

test('every short message size opens despite the surplus', async () => {
  for (const size of [0, 1, 3, 4, 7, 12, 27, 28, 29, 60, 61, 124, 125, 300]) {
    const message = new Uint8Array(size).fill(65);
    const sealed = await sealPassword(message, 'pw');
    for (const surplus of [0, 1, 5, 16]) {
      const carried = new Uint8Array(sealed.length + surplus);
      carried.set(sealed);
      assert.deepEqual(await openPasswordWithSurplus(carried, 'pw'), message, `${size}+${surplus}`);
    }
  }
});

test('stripFixedHeader refuses anything but the default settings', async () => {
  const other = await sealPassword(new Uint8Array(4), 'pw', { params: { ...ARGON2_V3, iterations: ARGON2_V3.iterations + 1 } });
  assert.throws(() => stripFixedHeader(other), /Unsupported/);
});

test('an altered cover never opens', async () => {
  const sealed = await sealPassword(new TextEncoder().encode('tajemstvi'), 'pw');
  const body = stripFixedHeader(sealed);
  const rand = seeded(5);
  const text = await codec.encode(body, rand);
  const words = text.split(' ');
  words[Math.floor(words.length / 2)] = words[Math.floor(words.length / 2)] === 'a' ? 'to' : 'a';
  const altered = words.join(' ');
  let failed = false;
  try {
    await openPasswordWithSurplus(restoreFixedHeader(await codec.decode(altered)), 'pw');
  } catch {
    failed = true;
  }
  assert.ok(failed);
});
