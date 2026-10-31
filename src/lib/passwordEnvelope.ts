import { ARGON2_V3, argon2id, equalBytes, hkdfAesKey, hkdfBytes, hkdfKey, type Argon2Params } from './kdf';
import { padme } from './padding';

const ECP3_MAGIC = new Uint8Array([69, 67, 80, 51, 1]); // ECP3, header layout 1
const HEADER = 72;
const TAG = 16;
const LENGTH = 4;
const FIXED_HEADER = 12;

/** Leading bytes of every password envelope. */
export const PASSWORD_ENVELOPE_MAGIC: Readonly<Uint8Array> = ECP3_MAGIC;
/** Fixed bytes an envelope adds to its plaintext, before padding. */
export const PASSWORD_ENVELOPE_OVERHEAD = HEADER + LENGTH + TAG;

/**
 * timeSecret: 32 random bytes released only by a drand time lock. They are mixed into the password-derived key, so
 * the envelope opens with both and with neither alone. Nothing in the envelope shows that it needs one.
 */
export type SealOptions = { maxLength?: number; params?: Argon2Params; timeSecret?: Uint8Array };

const TIME_SECRET_BYTES = 32;

/** Total envelope size for a plaintext: Padmé over the length-prefixed data, never past maxLength when the data alone fits. */
export function sealedLength(plaintext: number, maxLength = Infinity): number {
  const inner = LENGTH + plaintext;
  const ceiling = Math.max(inner, maxLength - HEADER - TAG);
  return HEADER + Math.min(padme(inner), ceiling) + TAG;
}

async function envelopeKeys(password: string, salt: Uint8Array, params: Argon2Params, timeSecret?: Uint8Array) {
  let base = await hkdfKey(await argon2id(password, salt, params));
  if (timeSecret) {
    if (timeSecret.length !== TIME_SECRET_BYTES) throw new Error('Invalid time secret');
    base = await hkdfKey(await hkdfBytes(base, 'encrypt.click/envelope/v3/timelock/v1', 32, timeSecret));
  }
  const [key, commitment] = await Promise.all([
    hkdfAesKey(base, 'encrypt.click/envelope/v3/key'),
    hkdfBytes(base, 'encrypt.click/envelope/v3/commit'),
  ]);
  return { key, commitment };
}

/**
 * ECP3: magic, layout version, Argon2id memory (KiB, u32), iterations (u16) and lanes (u8), salt (16), IV (12) and a
 * 32-byte key commitment, then AES-256-GCM over the length-prefixed, zero-padded plaintext with the whole header as AAD.
 */
export async function sealPassword(data: Uint8Array | Uint8Array[], password: string, options: SealOptions = {}): Promise<Uint8Array> {
  const parts = Array.isArray(data) ? data : [data];
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  if (length > 0xffffffff - LENGTH) throw new Error('Input too large');
  const params = options.params ?? ARGON2_V3;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const { key, commitment } = await envelopeKeys(password, salt, params, options.timeSecret);

  const header = new Uint8Array(HEADER);
  const view = new DataView(header.buffer);
  header.set(ECP3_MAGIC);
  view.setUint32(5, params.memory);
  view.setUint16(9, params.iterations);
  header[11] = params.parallelism;
  header.set(salt, 12);
  header.set(iv, 28);
  header.set(commitment, 40);

  const padded = new Uint8Array(sealedLength(length, options.maxLength) - HEADER - TAG);
  new DataView(padded.buffer).setUint32(0, length);
  let offset = LENGTH;
  for (const part of parts) { padded.set(part, offset); offset += part.length; }

  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, padded));
  const result = new Uint8Array(HEADER + cipher.length);
  result.set(header);
  result.set(cipher, HEADER);
  return result;
}

const startsWith = (data: Uint8Array, prefix: Uint8Array) => data.length >= prefix.length && prefix.every((byte, i) => data[i] === byte);

/** Header bytes shared by every envelope sealed with the default settings: magic, layout version and Argon2id settings. */
function fixedHeader(): Uint8Array {
  const fixed = new Uint8Array(FIXED_HEADER);
  const view = new DataView(fixed.buffer);
  fixed.set(ECP3_MAGIC);
  view.setUint32(5, ARGON2_V3.memory);
  view.setUint16(9, ARGON2_V3.iterations);
  fixed[11] = ARGON2_V3.parallelism;
  return fixed;
}

/** What remains of a default envelope without its constant bytes. It looks random, so a carrier shows no repeating pattern. */
export function stripFixedHeader(sealed: Uint8Array): Uint8Array {
  if (!startsWith(sealed, fixedHeader())) throw new Error('Unsupported encrypted data');
  return sealed.subarray(FIXED_HEADER);
}

export function restoreFixedHeader(body: Uint8Array): Uint8Array {
  const sealed = new Uint8Array(FIXED_HEADER + body.length);
  sealed.set(fixedHeader());
  sealed.set(body, FIXED_HEADER);
  return sealed;
}

async function openingKey(data: Uint8Array, password: string, timeSecret?: Uint8Array): Promise<CryptoKey> {
  if (!startsWith(data, ECP3_MAGIC)) throw new Error('Unsupported encrypted data');
  if (data.length < HEADER + LENGTH + TAG) throw new Error('Truncated encrypted data');
  const header = data.subarray(0, HEADER);
  const view = new DataView(header.buffer, header.byteOffset, HEADER);
  const params = { memory: view.getUint32(5), iterations: view.getUint16(9), parallelism: header[11] };
  const { key, commitment } = await envelopeKeys(password, header.slice(12, 28), params, timeSecret);
  if (!equalBytes(commitment, header.subarray(40, 72))) throw new Error('Wrong password');
  return key;
}

async function openBody(data: Uint8Array, end: number, key: CryptoKey): Promise<Uint8Array> {
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(28, 40), additionalData: data.slice(0, HEADER) },
    key, data.subarray(HEADER, end) as BufferSource));
  const length = new DataView(plain.buffer).getUint32(0);
  if (length > plain.length - LENGTH) throw new Error('Invalid padding');
  return plain.subarray(LENGTH, LENGTH + length);
}

export async function openPassword(data: Uint8Array, password: string, timeSecret?: Uint8Array): Promise<Uint8Array> {
  return openBody(data, data.length, await openingKey(data, password, timeSecret));
}

/**
 * For carriers that cannot mark where the envelope ends and yield a few extra bytes. Only a holder of the password can
 * tell the length, which keeps a cover from being confirmed without it. Tries every Padmé size that fits, longest first;
 * envelopes sealed with maxLength are not supported.
 */
export async function openPasswordWithSurplus(data: Uint8Array, password: string): Promise<Uint8Array> {
  const key = await openingKey(data, password);
  for (let end = data.length; end >= HEADER + LENGTH + TAG; end--) {
    const inner = end - HEADER - TAG;
    if (padme(inner) !== inner) continue;
    try {
      return await openBody(data, end, key);
    } catch {
      /* not this size */
    }
  }
  throw new Error('Wrong password');
}
