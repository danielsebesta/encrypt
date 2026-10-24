import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChatCodec, type ChatTable } from '../src/lib/chatWords';

const table: ChatTable = JSON.parse(readFileSync(new URL('../src/lib/chatTable.json', import.meta.url), 'utf8'));
import { PASSWORD_ENVELOPE_MAGIC } from '../src/lib/passwordEnvelope';
const codec = createChatCodec(table, { prefix: PASSWORD_ENVELOPE_MAGIC });

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function bytes(length: number, rand: () => number) {
  return Uint8Array.from({ length }, () => Math.floor(rand() * 256));
}

test('every message survives noise: accents, case, punctuation and typos', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const rand = seeded(seed);
    const data = bytes(Math.floor(rand() * 120), rand);
    const text = codec.encode(data, rand);
    assert.deepEqual(codec.decode(text), data, `seed ${seed}: ${text}`);
  }
});

test('large payloads round trip', () => {
  const rand = seeded(99);
  for (const length of [127, 128, 300, 2000, 16384]) {
    const data = bytes(length, rand);
    assert.deepEqual(codec.decode(codec.encode(data, rand)), data, `length ${length}`);
  }
});

test('typos actually appear and are still decoded', () => {
  let noisy = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rand = seeded(seed * 7);
    const data = bytes(60, rand);
    const text = codec.encode(data, rand);
    const plain = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
    if (plain.some(word => !table.words.some(w => w.normalize('NFD').replace(/[̀-ͯ]/g, '') === word.normalize('NFD').replace(/[̀-ͯ]/g, '')))) noisy++;
    assert.deepEqual(codec.decode(text), data);
  }
  assert.ok(noisy > 8, `only ${noisy} messages had typos`);
});

test('garbage and truncated input are rejected', () => {
  assert.throws(() => codec.decode(''));
  assert.throws(() => codec.decode('qqqqqqqq zzzzzzzz'));
  const rand = seeded(5);
  const text = codec.encode(bytes(40, rand), rand);
  assert.throws(() => codec.decode(text.split(' ').slice(0, 5).join(' ')));
});

test('the fixed envelope header is dropped from the words and restored on decode', () => {
  const rand = seeded(11);
  const sealed = Uint8Array.from([...PASSWORD_ENVELOPE_MAGIC, ...bytes(60, rand)]);
  assert.deepEqual(codec.decode(codec.encode(sealed, rand)), sealed);
  const plain = bytes(68, rand);
  assert.deepEqual(codec.decode(codec.encode(plain, rand)), plain);

  const count = (data: () => Uint8Array) => {
    let total = 0;
    for (let i = 0; i < 40; i++) total += codec.encode(data(), rand).split(/\s+/).length;
    return total / 40;
  };
  const withHeader = count(() => Uint8Array.from([...PASSWORD_ENVELOPE_MAGIC, ...bytes(60, rand)]));
  const without = count(() => bytes(68, rand));
  assert.ok(withHeader < without - 8, `header should save words: ${withHeader} vs ${without}`);
});
