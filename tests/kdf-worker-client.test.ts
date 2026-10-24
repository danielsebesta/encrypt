import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argon2Raw } from '../src/lib/argon2Core';

type WorkerScope = { onmessage: ((event: { data: unknown }) => void) | null; postMessage(message: unknown): void };
type Mode = 'normal' | 'error-reply' | 'post-throws' | 'crash';

const enc = new TextEncoder();
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const PARAMS = { memory: 8192, iterations: 2, parallelism: 1 };
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i + 1);

const scope: WorkerScope = { onmessage: null, postMessage: () => {} };
(globalThis as { self?: unknown }).self = scope;
await import('../src/lib/argon2Worker');

class FakeWorker {
  static mode: Mode = 'normal';
  static constructed = 0;
  static throwOnConstruct = false;
  static current: FakeWorker | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  terminated = false;

  constructor(readonly url: unknown, readonly options: unknown) {
    if (FakeWorker.throwOnConstruct) throw new Error('blocked');
    FakeWorker.constructed++;
    FakeWorker.current = this;
  }

  postMessage(data: unknown, transfer: ArrayBuffer[]) {
    if (FakeWorker.mode === 'post-throws') throw new Error('DataCloneError');
    const clone = structuredClone(data, { transfer });
    if (FakeWorker.mode === 'crash') {
      queueMicrotask(() => this.onerror?.({}));
      return;
    }
    const id = (clone as { id: number }).id;
    scope.postMessage = (message) => {
      const reply = structuredClone(message);
      queueMicrotask(() => this.onmessage?.({ data: reply }));
    };
    if (FakeWorker.mode === 'error-reply') {
      queueMicrotask(() => this.onmessage?.({ data: { id, error: 'boom' } }));
      return;
    }
    queueMicrotask(() => scope.onmessage!({ data: clone }));
  }

  terminate() {
    this.terminated = true;
  }
}

let instances = 0;

async function freshKdf(mode: Mode = 'normal', throwOnConstruct = false) {
  FakeWorker.mode = mode;
  FakeWorker.constructed = 0;
  FakeWorker.throwOnConstruct = throwOnConstruct;
  FakeWorker.current = null;
  Object.assign(globalThis, { window: {}, Worker: FakeWorker });
  return (await import(`../src/lib/kdf.ts?instance=${instances++}`)) as typeof import('../src/lib/kdf');
}

const expected = (password: string, salt: Uint8Array = SALT) => argon2Raw(enc.encode(password), salt, PARAMS).then(hex);

test('the browser path starts one worker lazily and answers concurrent calls with the in-thread bytes', async () => {
  const kdf = await freshKdf();
  assert.equal(FakeWorker.constructed, 0);
  const salts = [SALT, SALT.map((byte) => byte + 1), SALT.map((byte) => byte + 2)];
  const passwords = ['first password', 'second ✓ password', 'third password'];
  const before = salts.map((salt) => hex(salt));
  const results = await Promise.all(passwords.map((password, index) => kdf.argon2id(password, salts[index], PARAMS)));
  assert.equal(FakeWorker.constructed, 1);
  assert.deepEqual((FakeWorker.current!.options as { type: string }).type, 'module');
  for (const [index, password] of passwords.entries()) assert.equal(hex(results[index]), await expected(password, salts[index]));
  assert.deepEqual(salts.map((salt) => hex(salt)), before, 'the caller keeps its salt');
  assert.equal(hex(await kdf.argon2id('first password', SALT, PARAMS)), await expected('first password'));
  assert.equal(FakeWorker.constructed, 1);
  await assert.rejects(kdf.argon2id('x', SALT.slice(0, 8)), /Unsupported/);
  await assert.rejects(kdf.argon2id('x', SALT, { ...PARAMS, memory: 1 << 20 }), /Unsupported/);
  assert.equal(FakeWorker.constructed, 1);
});

test('an error reported by the worker rejects that call without leaving the worker', async () => {
  const kdf = await freshKdf('error-reply');
  await assert.rejects(kdf.argon2id('pw', SALT, PARAMS), /boom/);
  FakeWorker.mode = 'normal';
  assert.equal(hex(await kdf.argon2id('pw', SALT, PARAMS)), await expected('pw'));
  assert.equal(FakeWorker.constructed, 1);
  assert.equal(FakeWorker.current!.terminated, false);
});

test('a message the worker cannot take falls back to the calling thread for that call only', async () => {
  const kdf = await freshKdf('post-throws');
  assert.equal(hex(await kdf.argon2id('pw', SALT, PARAMS)), await expected('pw'));
  FakeWorker.mode = 'normal';
  assert.equal(hex(await kdf.argon2id('pw', SALT, PARAMS)), await expected('pw'));
  assert.equal(FakeWorker.constructed, 1);
});

test('a worker that dies mid-flight is retired and every pending call finishes in the calling thread', async () => {
  const kdf = await freshKdf('crash');
  const pending = [kdf.argon2id('one', SALT, PARAMS), kdf.argon2id('two', SALT, PARAMS)];
  const results = await Promise.all(pending);
  assert.equal(hex(results[0]), await expected('one'));
  assert.equal(hex(results[1]), await expected('two'));
  assert.equal(FakeWorker.current!.terminated, true);
  assert.equal(hex(await kdf.argon2id('three', SALT, PARAMS)), await expected('three'));
  assert.equal(FakeWorker.constructed, 1, 'no new worker after a failure');
});

test('a worker that cannot be created, or no Worker at all, means the calling thread does the work', async () => {
  const blocked = await freshKdf('normal', true);
  assert.equal(hex(await blocked.argon2id('pw', SALT, PARAMS)), await expected('pw'));
  assert.equal(FakeWorker.constructed, 0);

  const kdf = await freshKdf();
  delete (globalThis as { Worker?: unknown }).Worker;
  assert.equal(hex(await kdf.argon2id('pw', SALT, PARAMS)), await expected('pw'));
  assert.equal(FakeWorker.constructed, 0);
  delete (globalThis as { window?: unknown }).window;
});
