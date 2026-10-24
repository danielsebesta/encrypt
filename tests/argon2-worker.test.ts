import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import { argon2id } from '../src/lib/kdf';
import '../src/lib/argon2Core';

type Reply = { id: number; hash?: Uint8Array; error?: string };
type Scope = { onmessage: ((event: { data: unknown }) => void) | null; postMessage(message: unknown): void };

const waiting = new Map<number, (reply: Reply) => void>();
const order: number[] = [];
const scope: Scope = {
  onmessage: null,
  postMessage: (message) => {
    const reply = structuredClone(message) as Reply;
    order.push(reply.id);
    waiting.get(reply.id)?.(reply);
  },
};
// hash-wasm has to load above, before a global self exists, or Node misreads its CommonJS exports
(globalThis as { self?: unknown }).self = scope;
await import('../src/lib/argon2Worker');

const enc = new TextEncoder();
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const ask = (request: Record<string, unknown>) => new Promise<Reply>((resolve) => {
  waiting.set(request.id as number, resolve);
  scope.onmessage!({ data: request });
});
const request = (id: number, password: string, salt: Uint8Array, params = { memory: 65536, iterations: 3, parallelism: 1 }) =>
  ({ id, password: enc.encode(password), salt: salt.slice(), ...params });

const VECTORS = [
  { password: 'correct horse battery staple', salt: enc.encode('encrypt.click v3'), params: { memory: 65536, iterations: 3, parallelism: 1 }, expected: '0b3db99350124e912ab521e6229aedbe851835787bbc556681e5172d22979c2e' },
  { password: 'Kyber-Zebra-Moth-Lamp-Fern42', salt: Uint8Array.from({ length: 16 }, (_, i) => i * 17), params: { memory: 8192, iterations: 2, parallelism: 2 }, expected: null },
  { password: 'päss wörd ✓', salt: enc.encode('another sixteen+ byte salt'), params: { memory: 16384, iterations: 1, parallelism: 1 }, expected: null },
];

test('the worker handler returns the bytes the in-thread path returns, matching Node when it has Argon2', async () => {
  const native = (nodeCrypto as unknown as { argon2Sync?: (algorithm: string, options: object) => Uint8Array }).argon2Sync;
  for (const [index, vector] of VECTORS.entries()) {
    const reply = await ask(request(index, vector.password, vector.salt, vector.params));
    assert.equal(reply.error, undefined);
    assert.ok(reply.hash instanceof Uint8Array);
    const local = await argon2id(vector.password, vector.salt, vector.params);
    assert.equal(hex(reply.hash), hex(local));
    if (vector.expected) assert.equal(hex(reply.hash), vector.expected);
    if (typeof native === 'function') {
      const reference = native('argon2id', { message: vector.password, nonce: vector.salt, parallelism: vector.params.parallelism, tagLength: 32, memory: vector.params.memory, passes: vector.params.iterations });
      assert.equal(hex(reply.hash), hex(reference));
    }
  }
});

test('concurrent requests are answered once each, in order, and the buffers handed over are wiped', async () => {
  order.length = 0;
  const requests = VECTORS.map((vector, index) => request(100 + index, vector.password, vector.salt, vector.params));
  const replies = await Promise.all(requests.map(ask));
  assert.deepEqual(order, [100, 101, 102]);
  for (const [index, reply] of replies.entries()) {
    const vector = VECTORS[index];
    assert.equal(hex(reply.hash!), hex(await argon2id(vector.password, vector.salt, vector.params)));
    assert.ok(requests[index].password.every((byte) => byte === 0), 'password buffer is zeroed after use');
    assert.ok(requests[index].salt.every((byte) => byte === 0), 'salt copy is zeroed after use');
  }
});

test('the worker reports derivation failures and malformed requests instead of hanging', async () => {
  const salt = VECTORS[0].salt;
  const unsupported = await ask(request(200, 'x', salt, { memory: 1, iterations: 3, parallelism: 1 }));
  assert.equal(unsupported.hash, undefined);
  assert.match(unsupported.error ?? '', /Memory size/);

  assert.equal((await ask({ id: 201, password: 'not bytes', salt, memory: 65536, iterations: 3, parallelism: 1 })).error, 'Invalid request');
  assert.equal((await ask({ id: 202, password: enc.encode('x'), salt, memory: 1.5, iterations: 3, parallelism: 1 })).error, 'Invalid request');

  const after = await ask(request(203, VECTORS[0].password, salt));
  assert.equal(hex(after.hash!), VECTORS[0].expected);
  scope.onmessage!({ data: null });
});
