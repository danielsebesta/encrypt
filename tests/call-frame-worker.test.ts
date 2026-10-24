import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_TAG_BYTES, FRAME_TRAILER_BYTES, createMediaKey, encryptFrame, importFrameKey } from '../src/lib/callCrypto';

type Frame = { data: ArrayBuffer; type?: string };
type Scope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  onrtctransform: ((event: { transformer: unknown }) => void) | null;
  postMessage(message: unknown): void;
};

const posted: { op: string; peerId?: string }[] = [];
const scope: Scope = { onmessage: null, onrtctransform: null, postMessage: (message) => posted.push(message as { op: string }) };
(globalThis as { self?: unknown }).self = scope;
await import('../src/lib/callFrameWorker');

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const send = (data: unknown) => scope.onmessage!({ data });
const bytes = (length: number, seed: number) => Uint8Array.from({ length }, (_, i) => (i * 7 + seed) & 0xff);

function pipe(options: unknown, viaMessage = false) {
  const input = new TransformStream<Frame, Frame>();
  const output = new TransformStream<Frame, Frame>();
  const state = { keyFrameRequests: 0 };
  if (viaMessage) {
    scope.onmessage!({ data: { op: 'stream', ...(options as object), readable: input.readable, writable: output.writable } });
  } else {
    scope.onrtctransform!({
      transformer: {
        readable: input.readable,
        writable: output.writable,
        options,
        sendKeyFrameRequest: async () => { state.keyFrameRequests++; },
      },
    });
  }
  const writer = input.writable.getWriter();
  const reader = output.readable.getReader();
  let nextRead: Promise<Frame | null> | null = null;
  return {
    state,
    async push(frame: Frame, expectFrame = true): Promise<Frame | null> {
      writer.write(frame).catch(() => {});
      nextRead ??= reader.read().then((result) => result.value ?? null);
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), expectFrame ? 5000 : 80));
      const winner = await Promise.race([nextRead, timeout]);
      if (winner !== null) nextRead = null;
      return winner;
    },
  };
}

test('the worker seals outgoing frames, opens incoming ones and drops anything it cannot authenticate', async () => {
  const encrypt = pipe({ mode: 'encrypt', kind: 'video' });
  const decrypt = pipe({ mode: 'decrypt', kind: 'video', peerId: 'alice' });

  assert.equal(await encrypt.push({ data: bytes(300, 1).buffer, type: 'key' }, false), null, 'no plaintext leaves before a key is set');

  const key = createMediaKey();
  send({ op: 'send-key', keyId: key.id, raw: key.raw.slice().buffer });
  send({ op: 'receive-key', peerId: 'alice', keyId: key.id, raw: key.raw.slice().buffer });
  await settle();

  const original = bytes(300, 2);
  const sealed = await encrypt.push({ data: original.slice().buffer, type: 'key' });
  assert.ok(sealed);
  const sealedBytes = new Uint8Array(sealed.data);
  assert.equal(sealedBytes.length, 300 + FRAME_TAG_BYTES + FRAME_TRAILER_BYTES);
  assert.deepEqual(sealedBytes.subarray(0, 10), original.subarray(0, 10));
  assert.deepEqual(sealedBytes.at(-1), key.id);

  const opened = await decrypt.push({ data: sealed.data.slice(0), type: 'key' });
  assert.deepEqual(new Uint8Array(opened!.data), original);

  const tampered = sealedBytes.slice();
  tampered[50] ^= 1;
  assert.equal(await decrypt.push({ data: tampered.buffer, type: 'delta' }, false), null);
  assert.equal(await decrypt.push({ data: bytes(120, 3).buffer, type: 'delta' }, false), null, 'unencrypted frames are dropped');

  const stranger = await importFrameKey(createMediaKey().raw, (key.id + 9) & 0xff);
  const foreign = await encryptFrame(stranger, bytes(80, 4), 3);
  assert.equal(await decrypt.push({ data: foreign.buffer as ArrayBuffer, type: 'delta' }, false), null);
  assert.ok(posted.some((message) => message.op === 'missing' && message.peerId === 'alice'));

  const delta = await encrypt.push({ data: bytes(90, 5).buffer, type: 'delta' });
  const resumed = await decrypt.push({ data: delta!.data, type: 'delta' });
  assert.deepEqual(new Uint8Array(resumed!.data), bytes(90, 5));
  assert.equal(decrypt.state.keyFrameRequests, 1, 'video asks for a key frame after dropped frames');

  const next = createMediaKey(key);
  send({ op: 'receive-key', peerId: 'alice', keyId: next.id, raw: next.raw.slice().buffer });
  await settle();
  const inFlight = await encrypt.push({ data: bytes(60, 6).buffer, type: 'delta' });
  assert.ok(await decrypt.push({ data: inFlight!.data, type: 'delta' }), 'the previous key still opens frames in flight');
  send({ op: 'send-key', keyId: next.id, raw: next.raw.slice().buffer });
  await settle();
  const rotated = await encrypt.push({ data: bytes(60, 7).buffer, type: 'delta' });
  assert.equal(new Uint8Array(rotated!.data).at(-1), next.id);
  assert.ok(await decrypt.push({ data: rotated!.data, type: 'delta' }));

  send({ op: 'drop-peer', peerId: 'alice' });
  await settle();
  const afterDrop = await encrypt.push({ data: bytes(60, 8).buffer, type: 'delta' });
  assert.equal(await decrypt.push({ data: afterDrop!.data, type: 'delta' }, false), null);

  send({ op: 'wipe' });
  await settle();
  assert.equal(await encrypt.push({ data: bytes(60, 9).buffer, type: 'delta' }, false), null, 'a wiped worker sends nothing');
});

test('streams handed over by the legacy Chrome path get the same treatment, and bad options never pass frames', async () => {
  const key = createMediaKey();
  send({ op: 'send-key', keyId: key.id, raw: key.raw.slice().buffer });
  send({ op: 'receive-key', peerId: 'bob', keyId: key.id, raw: key.raw.slice().buffer });
  await settle();
  const encrypt = pipe({ mode: 'encrypt', kind: 'audio' }, true);
  const decrypt = pipe({ mode: 'decrypt', kind: 'audio', peerId: 'bob' }, true);
  const original = bytes(70, 10);
  const sealed = await encrypt.push({ data: original.slice().buffer });
  assert.equal(new Uint8Array(sealed!.data)[0], original[0]);
  assert.notDeepEqual(new Uint8Array(sealed!.data).subarray(1, 70), original.subarray(1));
  assert.deepEqual(new Uint8Array((await decrypt.push({ data: sealed!.data }))!.data), original);

  const broken = pipe({ mode: 'decrypt', kind: 'audio' });
  assert.equal(await broken.push({ data: sealed!.data.slice(0) }, false), null);
  const unknownMode = pipe({ mode: 'passthrough', kind: 'audio' }, true);
  assert.equal(await unknownMode.push({ data: original.slice().buffer }, false), null);
});
