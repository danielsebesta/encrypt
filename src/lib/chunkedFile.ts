import { CHUNK_CIPHER_OVERHEAD, CHUNK_PLAIN_BYTES, FIRST_PARTY_ENVELOPE_LIMIT, MAX_LEGACY_CHUNKED_PLAIN_BYTES } from './httpLimits';
import { hkdfAesKey, hkdfKey } from './kdf';
import { sealPassword, openPassword, PASSWORD_ENVELOPE_OVERHEAD, sealedLength } from './passwordEnvelope';
import { padme } from './padding';

/** Manifest layout marker: ECC1 + version byte. */
export const CHUNK_MANIFEST_MAGIC = new Uint8Array([0x45, 0x43, 0x43, 0x31, 1]);
export const FILE_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER = 72;
const LENGTH = 4;
/** Manifest envelopes stay tiny; only search this far for the sealed prefix. */
const MAX_ENVELOPE_BYTES = 16 * 1024;

export type ChunkManifest = {
  name: string;
  size: number;
  chunkSize: number;
  chunks: number;
};

export type SealedChunked = {
  /** Password envelope of the manifest (no ECLK marker). */
  envelope: Uint8Array;
  /** Per-chunk ciphertext: IV || ciphertext+tag. */
  parts: Uint8Array[];
  /** Total ciphertext bytes after the ECLK marker. */
  totalCipherBytes: number;
  manifest: ChunkManifest;
};

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function chunkCount(size: number, chunkSize: number): number {
  return size === 0 ? 1 : Math.ceil(size / chunkSize);
}

export function chunkPlainSizes(size: number, chunkSize = CHUNK_PLAIN_BYTES): number[] {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_LEGACY_CHUNKED_PLAIN_BYTES) throw new Error('Invalid size');
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > CHUNK_PLAIN_BYTES) throw new Error('Invalid chunk size');
  const count = chunkCount(size, chunkSize);
  const sizes: number[] = [];
  let left = size;
  for (let i = 0; i < count; i++) {
    const n = Math.min(chunkSize, left);
    sizes.push(n);
    left -= n;
  }
  return sizes;
}

export function chunkCipherSize(plainSize: number): number {
  return plainSize + CHUNK_CIPHER_OVERHEAD;
}

async function chunkKey(fileKey: Uint8Array, index: number): Promise<CryptoKey> {
  const base = await hkdfKey(fileKey);
  const salt = new Uint8Array(4);
  new DataView(salt.buffer).setUint32(0, index);
  return hkdfAesKey(base, 'encrypt.click/file-chunk/v1', salt);
}

function aadFor(index: number): Uint8Array {
  const aad = new Uint8Array(4);
  new DataView(aad.buffer).setUint32(0, index);
  return aad;
}

async function sealChunk(fileKey: Uint8Array, index: number, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await chunkKey(fileKey, index);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aadFor(index) as BufferSource },
    key,
    plain as BufferSource,
  ));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return out;
}

async function openChunk(fileKey: Uint8Array, index: number, part: Uint8Array): Promise<Uint8Array> {
  if (part.length < IV_BYTES + TAG_BYTES) throw new Error('Truncated chunk');
  const iv = part.subarray(0, IV_BYTES);
  const key = await chunkKey(fileKey, index);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aadFor(index) as BufferSource },
    key,
    part.subarray(IV_BYTES) as BufferSource,
  ));
}

function buildManifestPlain(meta: ChunkManifest, fileKey: Uint8Array): Uint8Array {
  const json = enc.encode(JSON.stringify({ v: 1, name: meta.name, size: meta.size, chunkSize: meta.chunkSize, chunks: meta.chunks }));
  if (json.length > 65536) throw new Error('Metadata too large');
  const plain = new Uint8Array(CHUNK_MANIFEST_MAGIC.length + LENGTH + json.length + FILE_KEY_BYTES);
  plain.set(CHUNK_MANIFEST_MAGIC);
  new DataView(plain.buffer).setUint32(CHUNK_MANIFEST_MAGIC.length, json.length);
  plain.set(json, CHUNK_MANIFEST_MAGIC.length + LENGTH);
  plain.set(fileKey, CHUNK_MANIFEST_MAGIC.length + LENGTH + json.length);
  return plain;
}

function parseManifestPlain(plain: Uint8Array): { manifest: ChunkManifest; fileKey: Uint8Array } {
  if (plain.length < CHUNK_MANIFEST_MAGIC.length + LENGTH + FILE_KEY_BYTES) throw new Error('Invalid chunked manifest');
  if (!CHUNK_MANIFEST_MAGIC.every((b, i) => plain[i] === b)) throw new Error('Invalid chunked manifest');
  const jsonLen = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(CHUNK_MANIFEST_MAGIC.length);
  const jsonStart = CHUNK_MANIFEST_MAGIC.length + LENGTH;
  const jsonEnd = jsonStart + jsonLen;
  if (jsonLen < 2 || jsonEnd + FILE_KEY_BYTES !== plain.length) throw new Error('Invalid chunked manifest');
  const meta = JSON.parse(dec.decode(plain.subarray(jsonStart, jsonEnd)));
  if (!meta || meta.v !== 1 || typeof meta.name !== 'string' || !Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > MAX_LEGACY_CHUNKED_PLAIN_BYTES
    || !Number.isSafeInteger(meta.chunkSize) || meta.chunkSize < 1 || meta.chunkSize > CHUNK_PLAIN_BYTES
    || !Number.isSafeInteger(meta.chunks) || meta.chunks !== chunkCount(meta.size, meta.chunkSize)) {
    throw new Error('Invalid chunked manifest');
  }
  return {
    manifest: { name: meta.name || 'decrypted-file', size: meta.size, chunkSize: meta.chunkSize, chunks: meta.chunks },
    fileKey: plain.slice(jsonEnd, jsonEnd + FILE_KEY_BYTES),
  };
}

/** True when a classic single-envelope seal would still fit under the first-party single-request limit. */
export function fitsSingleEnvelope(plainSize: number, name = ''): boolean {
  const meta = enc.encode(JSON.stringify({ name, size: plainSize }));
  const inner = 5 + meta.length + plainSize;
  return inner + PASSWORD_ENVELOPE_OVERHEAD <= FIRST_PARTY_ENVELOPE_LIMIT;
}

/**
 * Seals a file as a password envelope of the chunk manifest plus independently authenticated ciphertext parts.
 * Memory stays near one chunk: callers should pass slices rather than one giant buffer when possible.
 */
export async function sealChunkedFile(
  data: Uint8Array,
  password: string,
  originalName = '',
  options: { chunkSize?: number; timeSecret?: Uint8Array } = {},
): Promise<SealedChunked> {
  const chunkSize = options.chunkSize ?? CHUNK_PLAIN_BYTES;
  const sizes = chunkPlainSizes(data.length, chunkSize);
  const fileKey = crypto.getRandomValues(new Uint8Array(FILE_KEY_BYTES));
  const manifest: ChunkManifest = { name: originalName, size: data.length, chunkSize, chunks: sizes.length };
  const envelope = await sealPassword(buildManifestPlain(manifest, fileKey), password, { timeSecret: options.timeSecret });
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < sizes.length; i++) {
    parts.push(await sealChunk(fileKey, i, data.subarray(offset, offset + sizes[i])));
    offset += sizes[i];
  }
  fileKey.fill(0);
  return {
    envelope,
    parts,
    totalCipherBytes: envelope.length + parts.reduce((sum, part) => sum + part.length, 0),
    manifest,
  };
}

/** Seals one plaintext slice; used by streaming uploaders that never hold the whole file. */
export async function sealFileChunk(fileKey: Uint8Array, index: number, plain: Uint8Array): Promise<Uint8Array> {
  return sealChunk(fileKey, index, plain);
}

export async function sealChunkManifest(
  meta: ChunkManifest,
  fileKey: Uint8Array,
  password: string,
  timeSecret?: Uint8Array,
): Promise<Uint8Array> {
  return sealPassword(buildManifestPlain(meta, fileKey), password, { timeSecret });
}

export function createFileKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(FILE_KEY_BYTES));
}

export function expectedEnvelopeLength(manifestPlainLength: number): number {
  return sealedLength(manifestPlainLength);
}

export function manifestPlainLength(name: string, size: number, chunkSize: number, chunks: number): number {
  const json = enc.encode(JSON.stringify({ v: 1, name, size, chunkSize, chunks }));
  return CHUNK_MANIFEST_MAGIC.length + LENGTH + json.length + FILE_KEY_BYTES;
}

/**
 * Opens a downloaded chunked body (ECLK already stripped): sealed manifest envelope, then fixed-size cipher parts.
 * The envelope end is recovered by trying Padmé sizes within MAX_ENVELOPE_BYTES so the wire needs no length prefix
 * and part 0 still begins with a normal ECP3 magic the upload guard accepts.
 */
export async function openChunkedFile(data: Uint8Array, password: string, timeSecret?: Uint8Array): Promise<{ data: Uint8Array; name: string }> {
  if (data.length < HEADER + LENGTH + TAG_BYTES + IV_BYTES + TAG_BYTES) throw new Error('Truncated chunked file');
  if (data[0] !== 0x45 || data[1] !== 0x43 || data[2] !== 0x50 || data[3] !== 0x33 || data[4] !== 1) {
    throw new Error('Invalid chunked envelope');
  }

  let opened: { manifest: ChunkManifest; fileKey: Uint8Array; end: number } | null = null;
  const limit = Math.min(data.length, MAX_ENVELOPE_BYTES);
  for (let end = limit; end >= HEADER + LENGTH + TAG_BYTES; end--) {
    const inner = end - HEADER - TAG_BYTES;
    if (padme(inner) !== inner) continue;
    try {
      const plain = await openPassword(data.subarray(0, end), password, timeSecret);
      const parsed = parseManifestPlain(plain);
      opened = { ...parsed, end };
      break;
    } catch {
      /* try shorter Padmé size */
    }
  }
  if (!opened) throw new Error('Invalid chunked envelope');

  const { manifest, fileKey, end } = opened;
  try {
    const sizes = chunkPlainSizes(manifest.size, manifest.chunkSize);
    const out = new Uint8Array(manifest.size);
    let wire = end;
    let offset = 0;
    for (let i = 0; i < sizes.length; i++) {
      const partLen = chunkCipherSize(sizes[i]);
      if (wire + partLen > data.length) throw new Error('Truncated chunked file');
      const plain = await openChunk(fileKey, i, data.subarray(wire, wire + partLen));
      if (plain.length !== sizes[i]) throw new Error('Invalid chunk length');
      out.set(plain, offset);
      offset += plain.length;
      wire += partLen;
    }
    if (wire !== data.length) throw new Error('Trailing chunked bytes');
    return { data: out, name: manifest.name || 'decrypted-file' };
  } finally {
    fileKey.fill(0);
  }
}
