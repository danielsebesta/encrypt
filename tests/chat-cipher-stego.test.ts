import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStegoCodec, topIndices } from '../src/lib/chatCipher/stego';

function naiveTopIndices(logits: Float32Array, k: number, ban: Set<number>): number[] {
  const scored: { i: number; v: number }[] = [];
  for (let i = 0; i < logits.length; i++) {
    if (ban.has(i)) continue;
    scored.push({ i, v: logits[i]! });
  }
  scored.sort((a, b) => b.v - a.v || a.i - b.i);
  return scored.slice(0, k).map(s => s.i);
}

test('fast top-k matches a full sort including ties', () => {
  const logits = new Float32Array(64);
  for (let i = 0; i < logits.length; i++) logits[i] = Math.sin(i * 1.7) * 3;
  logits[3] = logits[9] = 10; // tie on value → lower index wins
  const ban = new Set([0, 1, 2]);
  assert.deepEqual(topIndices(logits, 8, ban), naiveTopIndices(logits, 8, ban));
});


/** Tiny deterministic LM: logits prefer id = (sum(context)+1) % vocab, with a smooth falloff. */
function mockLogits(vocab: number): (context: number[]) => Float32Array {
  return context => {
    const prefer = (context.reduce((a, b) => a + b, 0) + 1) % vocab;
    const logits = new Float32Array(vocab);
    for (let i = 0; i < vocab; i++) {
      const dist = Math.min(Math.abs(i - prefer), vocab - Math.abs(i - prefer));
      logits[i] = -dist;
    }
    return logits;
  };
}

test('stego round-trips random payloads on a mock LM', async () => {
  const codec = createStegoCodec(mockLogits(128), { start: [0], topK: 16, ban: [0], maxTokens: 5000 });
  for (const length of [0, 1, 7, 32, 200]) {
    const data = Uint8Array.from({ length }, (_, i) => (i * 17 + length) & 0xff);
    const tokens = await codec.encode(data);
    assert.deepEqual(await codec.decode(tokens), data, `length ${length}`);
  }
});

test('stego rejects tokens outside the top-k path', async () => {
  const codec = createStegoCodec(mockLogits(64), { start: [1], topK: 8, ban: [], maxTokens: 100 });
  const data = new Uint8Array([1, 2, 3, 4]);
  const tokens = await codec.encode(data);
  tokens[0] = 63;
  await assert.rejects(() => codec.decode(tokens));
});
