import { safeVideoCodecs, type FrameKind, type MediaKey } from './callCrypto';

export type FrameTransformMode = 'script' | 'streams';

type TransformOptions = { mode: 'encrypt' | 'decrypt'; kind: FrameKind; peerId?: string };
type EncodedStreams = { readable: ReadableStream; writable: WritableStream };
type ScriptTransformCtor = new (worker: Worker, options?: unknown, transfer?: Transferable[]) => unknown;

function scriptTransformCtor(): ScriptTransformCtor | null {
  const ctor = (globalThis as { RTCRtpScriptTransform?: ScriptTransformCtor }).RTCRtpScriptTransform;
  return typeof ctor === 'function' ? ctor : null;
}

/** RTCRtpScriptTransform (Safari, Firefox, current Chrome) first, then Chrome's older encoded insertable streams. */
export function frameTransformMode(): FrameTransformMode | null {
  if (typeof Worker === 'undefined' || typeof RTCRtpSender === 'undefined' || typeof RTCRtpReceiver === 'undefined') return null;
  if (!globalThis.crypto?.subtle) return null;
  if (scriptTransformCtor()) return 'script';
  const sender = RTCRtpSender.prototype as unknown as { createEncodedStreams?: unknown };
  const receiver = RTCRtpReceiver.prototype as unknown as { createEncodedStreams?: unknown };
  if (typeof sender.createEncodedStreams === 'function' && typeof receiver.createEncodedStreams === 'function') return 'streams';
  return null;
}

export class CallFrameEncryption {
  private readonly worker: Worker;
  private readonly secured = new WeakSet<object>();
  private readonly codecsSet = new WeakSet<RTCRtpTransceiver>();

  constructor(readonly mode: FrameTransformMode, handlers: { onMissingKey: (peerId: string) => void; onError: () => void }) {
    this.worker = new Worker(new URL('./callFrameWorker.ts', import.meta.url), { type: 'module', name: 'call-e2ee' });
    this.worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { op?: unknown; peerId?: unknown } | null;
      if (data?.op === 'missing' && typeof data.peerId === 'string') handlers.onMissingKey(data.peerId);
    };
    this.worker.onerror = () => handlers.onError();
  }

  /** The legacy Chrome path has to be switched on per connection; RTCRtpScriptTransform needs nothing. */
  peerConfig(): RTCConfiguration {
    return this.mode === 'streams' ? ({ encodedInsertableStreams: true } as RTCConfiguration) : {};
  }

  private attach(target: RTCRtpSender | RTCRtpReceiver, options: TransformOptions): boolean {
    if (this.secured.has(target)) return true;
    try {
      const Transform = scriptTransformCtor();
      if (this.mode === 'script' && Transform) {
        (target as unknown as { transform: unknown }).transform = new Transform(this.worker, options);
      } else {
        const { readable, writable } = (target as unknown as { createEncodedStreams(): EncodedStreams }).createEncodedStreams();
        this.worker.postMessage({ op: 'stream', ...options, readable, writable }, [readable as unknown as Transferable, writable as unknown as Transferable]);
      }
      this.secured.add(target);
      return true;
    } catch {
      return false;
    }
  }

  attachSender(sender: RTCRtpSender, kind: FrameKind): boolean {
    return this.attach(sender, { mode: 'encrypt', kind });
  }

  attachReceiver(receiver: RTCRtpReceiver, peerId: string): boolean {
    return this.attach(receiver, { mode: 'decrypt', kind: receiver.track.kind === 'video' ? 'video' : 'audio', peerId });
  }

  /** Puts the transforms on every sender and receiver of a connection and limits video to VP8 and VP9. */
  secure(pc: RTCPeerConnection, peerId: string) {
    for (const transceiver of pc.getTransceivers()) {
      if ((transceiver as RTCRtpTransceiver & { stopped?: boolean }).stopped || transceiver.currentDirection === 'stopped') continue;
      const kind: FrameKind = transceiver.receiver.track.kind === 'video' ? 'video' : 'audio';
      this.attachSender(transceiver.sender, kind);
      this.attachReceiver(transceiver.receiver, peerId);
      if (kind === 'video') this.preferSafeVideoCodecs(transceiver);
    }
  }

  /** Hands back a transceiver whose sender encrypts; any other is stopped so its track can never go out in the clear. */
  guard(transceiver: RTCRtpTransceiver | null): RTCRtpTransceiver | null {
    if (!transceiver || this.secured.has(transceiver.sender)) return transceiver;
    try { transceiver.stop(); } catch {}
    return null;
  }

  private preferSafeVideoCodecs(transceiver: RTCRtpTransceiver) {
    if (this.codecsSet.has(transceiver) || typeof transceiver.setCodecPreferences !== 'function') return;
    const codecs = safeVideoCodecs(RTCRtpReceiver.getCapabilities?.('video')?.codecs ?? []);
    if (!codecs.length) return;
    try {
      transceiver.setCodecPreferences(codecs);
      this.codecsSet.add(transceiver);
    } catch {}
  }

  setSendKey(key: MediaKey) {
    const raw = key.raw.slice();
    this.worker.postMessage({ op: 'send-key', keyId: key.id, raw: raw.buffer }, [raw.buffer]);
  }

  /** Hands the key bytes over to the worker; the caller's copy ends up detached or zeroed. */
  setReceiveKey(peerId: string, keyId: number, raw: Uint8Array) {
    const owned = raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength ? raw : raw.slice();
    if (owned !== raw) raw.fill(0);
    this.worker.postMessage({ op: 'receive-key', peerId, keyId, raw: owned.buffer }, [owned.buffer as ArrayBuffer]);
  }

  dropPeer(peerId: string) {
    this.worker.postMessage({ op: 'drop-peer', peerId });
  }

  close() {
    try { this.worker.postMessage({ op: 'wipe' }); } catch {}
    this.worker.terminate();
  }
}
