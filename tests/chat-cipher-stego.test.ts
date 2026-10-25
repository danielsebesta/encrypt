import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStegoCodec } from '../src/lib/chatCipher/stego';

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
