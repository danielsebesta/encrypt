import { ARGON2_V3, argon2id, equalBytes, hkdfAesKey, hkdfBytes, hkdfKey, type Argon2Params } from './kdf';
import { padme } from './padding';

const ECP3_MAGIC = new Uint8Array([69, 67, 80, 51, 1]); // ECP3, header layout 1
const ECP4_MAGIC = new Uint8Array([69, 67, 80, 52, 3]); // ECP4, compact layout 3: 8-byte salt, 64-bit tag, exact plaintext
const HEADER = 72;
const HEADER_COMPACT = 20;
const TAG = 16;
const TAG_COMPACT = 8;
const LENGTH_FULL = 4;
const FIXED_HEADER = 12;
const SALT_COMPACT = 8;

/** Leading bytes of every password envelope. */
export const PASSWORD_ENVELOPE_MAGIC: Readonly<Uint8Array> = ECP3_MAGIC;
/** Fixed bytes an envelope adds to its plaintext, before padding. */
export const PASSWORD_ENVELOPE_OVERHEAD = HEADER + LENGTH_FULL + TAG;

/**
 * timeSecret: 32 random bytes released only by a drand time lock. They are mixed into the password-derived key, so
 * the envelope opens with both and with neither alone. Nothing in the envelope shows that it needs one.
 */
export type SealOptions = { maxLength?: number; params?: Argon2Params; timeSecret?: Uint8Array; compact?: boolean };

/**
 * compact: the ECP4 layout for carriers that pay per byte. An 8-byte salt and a 64-bit GCM tag instead of the 16 and
 * 128 byte defaults: the salt only has to make precomputation pointless and a forgery still needs 2^64 tries, while
 * failed decrypts run offline in the reader's browser, so there is no oracle to farm. The Argon2id salt is the salt
 * run through SHA-256 (argon2id wants 16 bytes), the IV is derived from the key material, so every message still gets
 * a fresh key and a unique IV, and the body is the plaintext itself, with no length prefix and no Padmé rounding: the
 * GCM tag already pins the exact end, and the surplus opener asks it at every candidate size.
 * NIST SP 800-38D permits 64-bit tags. The key commitment is dropped: the GCM tag reports a wrong password.
 */
const TIME_SECRET_BYTES = 32;

/** Total envelope size for a plaintext: Padmé over the length-prefixed data, never past maxLength when the data alone fits. */
export function sealedLength(plaintext: number, maxLength = Infinity): number {
  const inner = LENGTH_FULL + plaintext;
  const ceiling = Math.max(inner, maxLength - HEADER - TAG);
  return HEADER + Math.min(padme(inner), ceiling) + TAG;
}

/** Total size of a compact envelope for a content payload. */
export function sealedCompactLength(content: number): number {
  return HEADER_COMPACT + content + TAG_COMPACT;
}

async function envelopeKeys(password: string, salt: Uint8Array, params: Argon2Params, options: Pick<SealOptions, 'compact' | 'timeSecret'> = {}) {
  const argonSalt = options.compact
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', salt as BufferSource)).slice(0, 16)
    : salt;
  let base = await hkdfKey(await argon2id(password, argonSalt, params));
  if (options.timeSecret) {
    if (options.compact) throw new Error('Unsupported envelope options');
    if (options.timeSecret.length !== TIME_SECRET_BYTES) throw new Error('Invalid time secret');
    base = await hkdfKey(await hkdfBytes(base, 'encrypt.click/envelope/v3/timelock/v1', 32, options.timeSecret));
  }
  if (options.compact) {
    const [key, iv] = await Promise.all([
      hkdfAesKey(base, 'encrypt.click/envelope/v4/key'),
      hkdfBytes(base, 'encrypt.click/envelope/v4/iv', 12),
    ]);
    return { key, iv, commitment: null as Uint8Array | null };
  }
  const [key, commitment] = await Promise.all([
    hkdfAesKey(base, 'encrypt.click/envelope/v3/key'),
    hkdfBytes(base, 'encrypt.click/envelope/v3/commit'),
  ]);
  return { key, iv: null as Uint8Array | null, commitment };
}

/**
 * ECP3: magic, layout version, Argon2id memory (KiB, u32), iterations (u16) and lanes (u8), salt (16), IV (12) and a
 * 32-byte key commitment, then AES-256-GCM over the length-prefixed, zero-padded plaintext with the whole header as AAD.
 * ECP4 compact: salt (8) and AES-256-GCM with a 64-bit tag over the bare plaintext, IV derived, no prefix or padding.
 */
export async function sealPassword(data: Uint8Array | Uint8Array[], password: string, options: SealOptions = {}): Promise<Uint8Array> {
  const parts = Array.isArray(data) ? data : [data];
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  if (options.compact) {
    if (options.maxLength !== undefined) throw new Error('Unsupported envelope options');
    if (length > 0xffff) throw new Error('Input too large');
  } else if (length > 0xffffffff - LENGTH_FULL) {
    throw new Error('Input too large');
  }
  const params = options.params ?? ARGON2_V3;
  const salt = crypto.getRandomValues(new Uint8Array(options.compact ? SALT_COMPACT : 16));
  const { key, iv, commitment } = await envelopeKeys(password, salt, params, options);
  const gcmIv = iv ?? crypto.getRandomValues(new Uint8Array(12));

  const headerLength = options.compact ? HEADER_COMPACT : HEADER;
  const header = new Uint8Array(headerLength);
  const view = new DataView(header.buffer);
  header.set(options.compact ? ECP4_MAGIC : ECP3_MAGIC);
  view.setUint32(5, params.memory);
  view.setUint16(9, params.iterations);
  header[11] = params.parallelism;
  header.set(salt, 12);
  if (!options.compact) {
    header.set(gcmIv, 28);
    header.set(commitment!, 40);
  }

  let padded: Uint8Array;
  let offset: number;
  if (options.compact) {
    padded = new Uint8Array(length);
    offset = 0;
  } else {
    const inner = LENGTH_FULL + length;
    const ceiling = Math.max(inner, (options.maxLength ?? Infinity) - headerLength - TAG);
    padded = new Uint8Array(Math.min(padme(inner), ceiling));
    new DataView(padded.buffer).setUint32(0, length);
    offset = LENGTH_FULL;
  }
  for (const part of parts) { padded.set(part, offset); offset += part.length; }

  const tagLength = options.compact ? (64 as const) : undefined;
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: gcmIv as BufferSource, additionalData: header, ...(tagLength ? { tagLength } : {}) }, key, padded as BufferSource));
  const result = new Uint8Array(headerLength + cipher.length);
  result.set(header);
  result.set(cipher, headerLength);
  return result;
}

const startsWith = (data: Uint8Array, prefix: Uint8Array) => data.length >= prefix.length && prefix.every((byte, i) => data[i] === byte);

/** Header bytes shared by every envelope sealed with the default settings: magic, layout version and Argon2id settings. */
function fixedHeader(compact: boolean): Uint8Array {
  const fixed = new Uint8Array(FIXED_HEADER);
  const view = new DataView(fixed.buffer);
  fixed.set(compact ? ECP4_MAGIC : ECP3_MAGIC);
  view.setUint32(5, ARGON2_V3.memory);
  view.setUint16(9, ARGON2_V3.iterations);
  fixed[11] = ARGON2_V3.parallelism;
  return fixed;
}

/** What remains of a default envelope without its constant bytes. It looks random, so a carrier shows no repeating pattern. */
export function stripFixedHeader(sealed: Uint8Array, compact = false): Uint8Array {
  if (!startsWith(sealed, fixedHeader(compact))) throw new Error('Unsupported encrypted data');
  return sealed.subarray(FIXED_HEADER);
}

export function restoreFixedHeader(body: Uint8Array, compact = false): Uint8Array {
  const sealed = new Uint8Array(FIXED_HEADER + body.length);
  sealed.set(fixedHeader(compact));
  sealed.set(body, FIXED_HEADER);
  return sealed;
}

interface OpenedLayout {
  key: CryptoKey;
  iv: Uint8Array;
  headerLength: number;
  compact: boolean;
}

async function openingLayout(data: Uint8Array, password: string, timeSecret?: Uint8Array): Promise<OpenedLayout> {
  const compact = startsWith(data, ECP4_MAGIC);
  if (!compact && !startsWith(data, ECP3_MAGIC)) throw new Error('Unsupported encrypted data');
  const headerLength = compact ? HEADER_COMPACT : HEADER;
  const minBody = compact ? 1 + TAG_COMPACT : LENGTH_FULL + TAG;
  if (data.length < headerLength + minBody) throw new Error('Truncated encrypted data');
  const header = data.subarray(0, headerLength);
  const view = new DataView(header.buffer, header.byteOffset, headerLength);
  const params = { memory: view.getUint32(5), iterations: view.getUint16(9), parallelism: header[11] };
  const { key, iv, commitment } = await envelopeKeys(password, header.slice(12, 12 + (compact ? SALT_COMPACT : 16)), params, { compact, timeSecret });
  if (!compact && !equalBytes(commitment!, header.subarray(40, 72))) throw new Error('Wrong password');
  return { key, iv: compact ? iv! : header.slice(28, 40), headerLength, compact };
}

/** Full layout: Padmé-sized inner, 128-bit tag, u32 length over zero-padded data. */
async function openFullBody(data: Uint8Array, end: number, opened: OpenedLayout): Promise<Uint8Array> {
  const plain = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: opened.iv as BufferSource, additionalData: data.slice(0, opened.headerLength) },
    opened.key,
    data.subarray(opened.headerLength, end) as BufferSource,
  ));
  const length = new DataView(plain.buffer).getUint32(0);
  if (length > plain.length - LENGTH_FULL) throw new Error('Invalid padding');
  return plain.subarray(LENGTH_FULL, LENGTH_FULL + length);
}

/** Compact layout: the plaintext as it is, 64-bit tag. The tag is the only length check. */
async function openCompactBody(data: Uint8Array, end: number, opened: OpenedLayout): Promise<Uint8Array> {
  const plain = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: opened.iv as BufferSource, additionalData: data.slice(0, opened.headerLength), tagLength: 64 as const },
    opened.key,
    data.subarray(opened.headerLength, end) as BufferSource,
  ));
  if (plain.length < 1) throw new Error('Invalid padding');
  return plain;
}

export async function openPassword(data: Uint8Array, password: string, timeSecret?: Uint8Array): Promise<Uint8Array> {
  const opened = await openingLayout(data, password, timeSecret);
  const openBody = opened.compact ? openCompactBody : openFullBody;
  return openBody(data, data.length, opened);
}

/**
 * For carriers that cannot mark where the envelope ends and yield a few extra bytes. Only a holder of the password can
 * tell the length, which keeps a cover from being confirmed without it. The full layout tries every Padmé size that
 * fits, the compact layout every byte, longest end first; envelopes sealed with maxLength are not supported.
 */
export async function openPasswordWithSurplus(data: Uint8Array, password: string): Promise<Uint8Array> {
  const opened = await openingLayout(data, password);
  if (opened.compact) {
    for (let end = data.length; end >= opened.headerLength + 1 + TAG_COMPACT; end--) {
      try {
        return await openCompactBody(data, end, opened);
      } catch {
        /* not this size */
      }
    }
    throw new Error('Wrong password');
  }
  for (let end = data.length; end >= opened.headerLength + LENGTH_FULL + TAG; end--) {
    const inner = end - opened.headerLength - TAG;
    if (padme(inner) !== inner) continue;
    try {
      return await openFullBody(data, end, opened);
    } catch {
      /* not this size */
    }
  }
  throw new Error('Wrong password');
}
