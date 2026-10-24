import { FrameKeyring, decryptFrame, encryptFrame, framePrefixLength, importFrameKey, isMediaKeyId, readFrameHeader, type FrameKey, type FrameKind } from './callCrypto';

type EncodedFrame = { data: ArrayBuffer; type?: string };
type Options = { mode: 'encrypt'; kind: FrameKind } | { mode: 'decrypt'; kind: FrameKind; peerId: string };
type Transformer = {
  readable: ReadableStream<EncodedFrame>;
  writable: WritableStream<EncodedFrame>;
  options?: unknown;
  sendKeyFrameRequest?: () => Promise<void>;
};
type Scope = {
  onmessage: ((event: MessageEvent) => void) | null;
  onrtctransform: ((event: { transformer: Transformer }) => void) | null;
  postMessage(message: unknown): void;
};

const scope = self as unknown as Scope;
const keyring = new FrameKeyring();
const missingReportedAt = new Map<string, number>();
const MISSING_REPORT_MS = 1000;
const KEY_FRAME_REQUEST_MS = 1000;
let sendKey: FrameKey | null = null;
let queue: Promise<void> = Promise.resolve();

function parseOptions(value: unknown): Options | null {
  const options = value as { mode?: unknown; kind?: unknown; peerId?: unknown } | null;
  if (!options || (options.kind !== 'audio' && options.kind !== 'video')) return null;
  if (options.mode === 'encrypt') return { mode: 'encrypt', kind: options.kind };
  if (options.mode === 'decrypt' && typeof options.peerId === 'string' && options.peerId) return { mode: 'decrypt', kind: options.kind, peerId: options.peerId };
  return null;
}

function reportMissing(peerId: string) {
  const now = Date.now();
  if (now - (missingReportedAt.get(peerId) ?? 0) < MISSING_REPORT_MS) return;
  missingReportedAt.set(peerId, now);
  scope.postMessage({ op: 'missing', peerId });
}

function encryptor(kind: FrameKind) {
  return async (frame: EncodedFrame, controller: TransformStreamDefaultController<EncodedFrame>) => {
    const key = sendKey;
    if (!key) return;
    const data = new Uint8Array(frame.data);
    if (!data.length) {
      controller.enqueue(frame);
      return;
    }
    try {
      frame.data = (await encryptFrame(key, data, framePrefixLength(kind, frame.type, data.length))).buffer as ArrayBuffer;
      controller.enqueue(frame);
    } catch {}
  };
}

function decryptor(peerId: string, kind: FrameKind, transformer?: Transformer) {
  let stalled = false;
  let requestedAt = 0;
  return async (frame: EncodedFrame, controller: TransformStreamDefaultController<EncodedFrame>) => {
    const data = new Uint8Array(frame.data);
    if (!data.length) {
      controller.enqueue(frame);
      return;
    }
    const header = readFrameHeader(data);
    const key = header ? keyring.get(peerId, header.keyId) : undefined;
    if (header && !key) reportMissing(peerId);
    const plain = header && key ? await decryptFrame(data, header, key) : null;
    if (!plain) {
      stalled = true;
      return;
    }
    if (stalled) {
      const now = Date.now();
      if (kind === 'audio' || frame.type === 'key') {
        stalled = false;
      } else if (transformer?.sendKeyFrameRequest && now - requestedAt > KEY_FRAME_REQUEST_MS) {
        requestedAt = now;
        stalled = false;
        Promise.resolve().then(() => transformer.sendKeyFrameRequest?.()).catch(() => {});
      }
    }
    frame.data = plain.buffer as ArrayBuffer;
    controller.enqueue(frame);
  };
}

function run(value: unknown, readable: unknown, writable: unknown, transformer?: Transformer) {
  const options = parseOptions(value);
  if (!options || !(readable instanceof ReadableStream) || !(writable instanceof WritableStream)) return;
  const transform = options.mode === 'encrypt' ? encryptor(options.kind) : decryptor(options.peerId, options.kind, transformer);
  readable.pipeThrough(new TransformStream<EncodedFrame, EncodedFrame>({ transform })).pipeTo(writable).catch(() => {});
}

async function handle(message: { op?: unknown; peerId?: unknown; keyId?: unknown; raw?: unknown }) {
  if (message.op === 'wipe') {
    sendKey = null;
    keyring.clear();
    return;
  }
  if (message.op === 'drop-peer' && typeof message.peerId === 'string') {
    keyring.drop(message.peerId);
    missingReportedAt.delete(message.peerId);
    return;
  }
  if ((message.op !== 'send-key' && message.op !== 'receive-key') || !isMediaKeyId(message.keyId) || !(message.raw instanceof ArrayBuffer)) return;
  const raw = new Uint8Array(message.raw);
  try {
    const key = await importFrameKey(raw, message.keyId);
    if (message.op === 'send-key') sendKey = key;
    else if (typeof message.peerId === 'string' && message.peerId) keyring.set(message.peerId, key);
  } catch {
  } finally {
    raw.fill(0);
  }
}

scope.onmessage = (event: MessageEvent) => {
  const message = event.data as { op?: unknown; mode?: unknown; kind?: unknown; peerId?: unknown; readable?: unknown; writable?: unknown } | null;
  if (!message) return;
  if (message.op === 'stream') {
    run(message, message.readable, message.writable);
    return;
  }
  queue = queue.then(() => handle(message)).catch(() => {});
};

scope.onrtctransform = (event) => {
  const { transformer } = event;
  run(transformer.options, transformer.readable, transformer.writable, transformer);
};
