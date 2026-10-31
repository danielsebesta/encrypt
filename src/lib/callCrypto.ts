// Frame encryption for calls, modelled on SFrame (RFC 9605). Every encoded audio or video frame is sealed with
// AES-256-GCM before the browser packetizes it. Layout of a protected frame:
//   | clear codec prefix | ciphertext | 16-byte tag | counter (u64 BE) | prefix length (u8) | key id (u8) |
// The clear prefix and the 10-byte trailer are the additional data, and the IV is the per-key salt XOR the counter.

export type FrameKind = 'audio' | 'video';
export type FrameKey = { id: number; key: CryptoKey; salt: Uint8Array; counter: bigint };
export type FrameHeader = { keyId: number; counter: bigint; prefixLength: number };
export type MediaKey = { id: number; raw: Uint8Array };
export type CallKeyPair = { privateKey: CryptoKey; publicKey: string };

export const MEDIA_KEY_BYTES = 32;
export const FRAME_TAG_BYTES = 16;
export const FRAME_TRAILER_BYTES = 10;
export const MAX_FRAME_PREFIX = 10;
export const MEDIA_KEY_ACTIVATE_DELAY_MS = 2000;
export const RECEIVE_KEY_GRACE_MS = 10_000;

const MAX_COUNTER = 0xffff_ffff_ffff_ffffn;
const IV_BYTES = 12;
const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{87}$/;
const WRAPPED_KEY_RE = /^[A-Za-z0-9_-]{80}$/;
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toB64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function isMediaKeyId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255;
}

export function isCallPublicKey(value: unknown): value is string {
  if (typeof value !== 'string' || !PUBLIC_KEY_RE.test(value)) return false;
  try { return fromB64url(value)[0] === 4; } catch { return false; }
}

/** VP8 key frames keep their 10-byte header readable and delta frames 3 bytes, Opus its TOC byte, as the packetizers need them. */
export function framePrefixLength(kind: FrameKind, type: string | undefined, length: number): number {
  const wanted = kind === 'audio' ? 1 : type === 'key' ? 10 : 3;
  return Math.max(0, Math.min(wanted, length));
}

export function frameIv(salt: Uint8Array, counter: bigint): Uint8Array {
  if (salt.length !== IV_BYTES || counter < 0n || counter > MAX_COUNTER) throw new Error('Invalid frame IV input');
  const iv = new Uint8Array(salt);
  const view = new DataView(iv.buffer);
  view.setBigUint64(4, view.getBigUint64(4) ^ counter);
  return iv;
}

export async function importFrameKey(raw: Uint8Array, id: number): Promise<FrameKey> {
  if (raw.length !== MEDIA_KEY_BYTES || !isMediaKeyId(id)) throw new Error('Invalid media key');
  const base = await crypto.subtle.importKey('raw', raw as BufferSource, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const params = (label: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: concat(encoder.encode(`encrypt.click call frame v1 ${label}`), Uint8Array.of(id)),
  });
  const key = await crypto.subtle.deriveKey(params('key'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const salt = new Uint8Array(await crypto.subtle.deriveBits(params('salt'), base, IV_BYTES * 8));
  return { id, key, salt, counter: 0n };
}

export async function encryptFrame(key: FrameKey, data: Uint8Array, prefixLength: number): Promise<Uint8Array> {
  if (key.counter > MAX_COUNTER) throw new Error('Media key exhausted');
  const counter = key.counter++;
  const prefix = data.subarray(0, Math.max(0, Math.min(prefixLength, data.length, MAX_FRAME_PREFIX)));
  const trailer = new Uint8Array(FRAME_TRAILER_BYTES);
  new DataView(trailer.buffer).setBigUint64(0, counter);
  trailer[8] = prefix.length;
  trailer[9] = key.id;
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: frameIv(key.salt, counter) as BufferSource, additionalData: concat(prefix, trailer) as BufferSource, tagLength: 128 },
    key.key,
    data.subarray(prefix.length) as BufferSource,
  ));
  return concat(prefix, sealed, trailer);
}

export function readFrameHeader(data: Uint8Array): FrameHeader | null {
  if (data.length < FRAME_TAG_BYTES + FRAME_TRAILER_BYTES) return null;
  const at = data.length - FRAME_TRAILER_BYTES;
  const prefixLength = data[at + 8];
  if (prefixLength > MAX_FRAME_PREFIX || prefixLength + FRAME_TAG_BYTES + FRAME_TRAILER_BYTES > data.length) return null;
  const counter = new DataView(data.buffer, data.byteOffset + at, 8).getBigUint64(0);
  return { keyId: data[at + 9], counter, prefixLength };
}

/** Returns the plain frame, or null when the frame was not sealed with this key exactly as received. */
export async function decryptFrame(data: Uint8Array, header: FrameHeader, key: FrameKey): Promise<Uint8Array | null> {
  if (header.keyId !== key.id) return null;
  const at = data.length - FRAME_TRAILER_BYTES;
  const prefix = data.subarray(0, header.prefixLength);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: frameIv(key.salt, header.counter) as BufferSource, additionalData: concat(prefix, data.subarray(at)) as BufferSource, tagLength: 128 },
      key.key,
      data.subarray(header.prefixLength, at) as BufferSource,
    );
    return concat(prefix, new Uint8Array(plain));
  } catch {
    return null;
  }
}

function newerKeyId(candidate: number, current: number): boolean {
  return ((candidate - current) & 0xff) < 128;
}

/** Receive keys per sender. A superseded key stays usable for a grace period so frames already in flight still decrypt. */
export class FrameKeyring {
  private peers = new Map<string, Map<number, { key: FrameKey; expires: number }>>();

  constructor(private readonly graceMs = RECEIVE_KEY_GRACE_MS, private readonly maxKeys = 4) {}

  set(peerId: string, key: FrameKey, now = Date.now()) {
    const keys = this.peers.get(peerId) ?? new Map<number, { key: FrameKey; expires: number }>();
    const current = [...keys].find(([, entry]) => entry.expires === Infinity)?.[0];
    keys.delete(key.id);
    if (current !== undefined && current !== key.id && !newerKeyId(key.id, current)) {
      keys.set(key.id, { key, expires: now + this.graceMs });
    } else {
      for (const entry of keys.values()) entry.expires = Math.min(entry.expires, now + this.graceMs);
      keys.set(key.id, { key, expires: Infinity });
    }
    while (keys.size > this.maxKeys) keys.delete(keys.keys().next().value as number);
    this.peers.set(peerId, keys);
  }

  get(peerId: string, keyId: number, now = Date.now()): FrameKey | undefined {
    const keys = this.peers.get(peerId);
    const entry = keys?.get(keyId);
    if (!keys || !entry) return undefined;
    if (entry.expires <= now) {
      keys.delete(keyId);
      return undefined;
    }
    return entry.key;
  }

  drop(peerId: string) {
    this.peers.delete(peerId);
  }

  clear() {
    this.peers.clear();
  }
}

export function createMediaKey(previous?: MediaKey | null): MediaKey {
  const id = previous ? (previous.id + 1) & 0xff : crypto.getRandomValues(new Uint8Array(1))[0];
  return { id, raw: crypto.getRandomValues(new Uint8Array(MEDIA_KEY_BYTES)) };
}

/**
 * The local sender key. `latest` is what peers are given; a rotated key reaches the frame encryptor only after a delay,
 * so peers have it before the first frame sealed with it arrives. A rotation that is overtaken by another never activates.
 */
export class MediaKeySchedule {
  latest: MediaKey | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly activate: (key: MediaKey) => void, private readonly delayMs = MEDIA_KEY_ACTIVATE_DELAY_MS) {}

  start(): MediaKey {
    this.wipe();
    const key = createMediaKey();
    this.latest = key;
    this.activate(key);
    return key;
  }

  rotate(): MediaKey {
    const next = createMediaKey(this.latest);
    this.latest?.raw.fill(0);
    this.latest = next;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.latest === next) this.activate(next);
    }, this.delayMs);
    return next;
  }

  wipe() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.latest?.raw.fill(0);
    this.latest = null;
  }
}

export async function createCallKeyPair(): Promise<CallKeyPair> {
  const pair = await crypto.subtle.generateKey(P256, false, ['deriveBits']) as CryptoKeyPair;
  const publicKey = toB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return { privateKey: pair.privateKey, publicKey };
}

/**
 * Key that seals one media key for one call member, so other room members who can read the signaling still cannot unwrap it.
 * It is made from ECDH and an ML-KEM secret encapsulated for that recipient, so a recording opens only if both are broken.
 */
export async function deriveWrapKey(pair: CallKeyPair, peerPublicKey: string, kemSecret: Uint8Array): Promise<CryptoKey> {
  if (!isCallPublicKey(peerPublicKey) || peerPublicKey === pair.publicKey || kemSecret.length !== MEDIA_KEY_BYTES) throw new Error('Invalid call key');
  const peer = await crypto.subtle.importKey('raw', fromB64url(peerPublicKey) as BufferSource, P256, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, pair.privateKey, 256));
  const ikm = concat(shared, kemSecret);
  const [first, second] = [pair.publicKey, peerPublicKey].sort();
  try {
    const base = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: concat(fromB64url(first), fromB64url(second)) as BufferSource, info: encoder.encode('encrypt.click call key wrap v2') },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    shared.fill(0);
    ikm.fill(0);
  }
}

export function mediaKeyContext(callId: string, from: string, to: string, keyId: number): string {
  return `encrypt.click call media key v1\n${callId}\n${from}\n${to}\n${keyId}`;
}

export async function wrapMediaKey(wrapKey: CryptoKey, raw: Uint8Array, context: string): Promise<string> {
  if (raw.length !== MEDIA_KEY_BYTES) throw new Error('Invalid media key');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, wrapKey, raw as BufferSource));
  return toB64url(concat(iv, sealed));
}

export async function unwrapMediaKey(wrapKey: CryptoKey, wrapped: unknown, context: string): Promise<Uint8Array | null> {
  if (typeof wrapped !== 'string' || !WRAPPED_KEY_RE.test(wrapped)) return null;
  const bytes = fromB64url(wrapped);
  try {
    const raw = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES) as BufferSource, additionalData: encoder.encode(context) },
      wrapKey,
      bytes.subarray(IV_BYTES) as BufferSource,
    ));
    return raw.length === MEDIA_KEY_BYTES ? raw : null;
  } catch {
    return null;
  }
}

const SAFE_VIDEO_CODECS = ['video/vp8', 'video/vp9'];
const VIDEO_REPAIR_CODECS = ['video/rtx', 'video/red', 'video/ulpfec', 'video/flexfec-03'];

/** VP8 and VP9 packetizers never parse the payload; H.264 and AV1 ones read NAL units or OBUs, which are ciphertext here. */
export function safeVideoCodecs<T extends { mimeType: string }>(codecs: readonly T[]): T[] {
  const rank = (codec: T) => SAFE_VIDEO_CODECS.indexOf(codec.mimeType.toLowerCase());
  const video = codecs.filter((codec) => rank(codec) >= 0).sort((a, b) => rank(a) - rank(b));
  if (!video.length) return [];
  return [...video, ...codecs.filter((codec) => VIDEO_REPAIR_CODECS.includes(codec.mimeType.toLowerCase()))];
}

const AUDIO_LEVEL_EXTENSION = /^a=extmap:\d+(?:\/\w+)? urn:ietf:params:rtp-hdrext:[sc]src-audio-level(?:\s|$)/i;

/**
 * Opus at a constant bitrate without silence suppression, and no audio level header, which travels unencrypted, so nothing
 * the relay sees follows what is being said. A browser takes these settings for what it sends from the description the other side sent.
 */
export function hideVoiceActivity<T extends { sdp?: string }>(description: T): T {
  if (!description.sdp) return description;
  const eol = description.sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = description.sdp.split(/\r?\n/).filter((line) => !AUDIO_LEVEL_EXTENSION.test(line));
  for (const [, payload] of description.sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000/gim)) {
    const prefix = `a=fmtp:${payload} `;
    const at = lines.findIndex((line) => line.startsWith(prefix));
    if (at >= 0) {
      const kept = lines[at].slice(prefix.length).split(';').filter((part) => part && !/^\s*(cbr|usedtx)=/i.test(part));
      lines[at] = `${prefix}${[...kept, 'cbr=1', 'usedtx=0'].join(';')}`;
    } else {
      lines.splice(lines.findIndex((line) => line.startsWith(`a=rtpmap:${payload} `)) + 1, 0, `${prefix}cbr=1;usedtx=0`);
    }
  }
  return { ...description, sdp: lines.join(eol) };
}
