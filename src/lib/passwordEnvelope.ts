import { ARGON2_V3, argon2id, equalBytes, hkdfAesKey, hkdfBytes, hkdfKey, type Argon2Params } from './kdf';
import { padme } from './padding';

const ECP2_MAGIC = new Uint8Array([69, 67, 80, 50, 0, 9, 39, 192]); // ECP2, PBKDF2-SHA256 600000
const ECP3_MAGIC = new Uint8Array([69, 67, 80, 51, 1]); // ECP3, header layout 1
const HEADER = 72;
const TAG = 16;
const LENGTH = 4;

/** Leading bytes of the marked envelope formats; new envelopes are always the first. */
export const PASSWORD_ENVELOPE_MAGICS: readonly Uint8Array[] = [ECP3_MAGIC, ECP2_MAGIC];
/** Fixed bytes a version 3 envelope adds to its plaintext, before padding. */
export const PASSWORD_ENVELOPE_OVERHEAD = HEADER + LENGTH + TAG;

export type SealOptions = { maxLength?: number; params?: Argon2Params };

export async function passwordKey(password: string, salt: Uint8Array, iterations = 600_000): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Total envelope size for a plaintext: Padmé over the length-prefixed data, never past maxLength when the data alone fits. */
export function sealedLength(plaintext: number, maxLength = Infinity): number {
  const inner = LENGTH + plaintext;
  const ceiling = Math.max(inner, maxLength - HEADER - TAG);
  return HEADER + Math.min(padme(inner), ceiling) + TAG;
}

async function envelopeKeys(password: string, salt: Uint8Array, params: Argon2Params) {
  const base = await hkdfKey(await argon2id(password, salt, params));
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
  const { key, commitment } = await envelopeKeys(password, salt, params);

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

async function openV3(data: Uint8Array, password: string): Promise<Uint8Array> {
  if (data.length < HEADER + LENGTH + TAG) throw new Error('Truncated encrypted data');
  const header = data.subarray(0, HEADER);
  const view = new DataView(header.buffer, header.byteOffset, HEADER);
  const params = { memory: view.getUint32(5), iterations: view.getUint16(9), parallelism: header[11] };
  const { key, commitment } = await envelopeKeys(password, header.slice(12, 28), params);
  if (!equalBytes(commitment, header.subarray(40, 72))) throw new Error('Wrong password');
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: header.slice(28, 40), additionalData: header.slice() },
    key, data.subarray(HEADER) as BufferSource));
  const length = new DataView(plain.buffer).getUint32(0);
  if (length > plain.length - LENGTH) throw new Error('Invalid padding');
  return plain.subarray(LENGTH, LENGTH + length);
}

export type OpenedEnvelope = { plaintext: Uint8Array; version: 1 | 2 | 3 };

export async function openPasswordEnvelope(data: Uint8Array, password: string): Promise<OpenedEnvelope> {
  if (startsWith(data, ECP3_MAGIC)) return { plaintext: await openV3(data, password), version: 3 };
  if (data.length < 44) throw new Error('Truncated encrypted data');
  const modern = startsWith(data, ECP2_MAGIC);
  const offset = modern ? 8 : 0;
  const key = await passwordKey(password, data.slice(offset, offset + 16), modern ? 600_000 : 100_000);
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(offset + 16, offset + 28),
    ...(modern ? { additionalData: ECP2_MAGIC } : {}) }, key, data.slice(offset + 28)));
  return { plaintext, version: modern ? 2 : 1 };
}

export async function openPassword(data: Uint8Array, password: string): Promise<Uint8Array> {
  return (await openPasswordEnvelope(data, password)).plaintext;
}
