import { hkdfAesKey, hkdfBytes, hkdfKey } from './kdf';

/**
 * ECK1: an envelope under a raw 256-bit key, for payloads whose key is not a password (chat attachments and voice,
 * whose key travels inside the room's encrypted message). HKDF replaces Argon2id — a random key is not guessable at
 * human rates, so the stretch costs six-digit milliseconds and buys nothing. Callers must never seal with a string a
 * person might type: the format has no slow KDF to protect it, so that would drop the cost of a guess by design.
 */
const ECK1_MAGIC = new Uint8Array([0x45, 0x43, 0x4b, 0x31, 1]); // ECK1, layout 1
/** Leading bytes of every raw-key envelope. */
export const KEY_ENVELOPE_MAGIC: Readonly<Uint8Array> = ECK1_MAGIC;
const SALT_BYTES = 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_LENGTH = ECK1_MAGIC.length + SALT_BYTES;
export const KEY_ENVELOPE_BYTES = 32;

const startsWith = (data: Uint8Array, prefix: Uint8Array) => data.length >= prefix.length && prefix.every((byte, i) => data[i] === byte);

/** True for a blob sealed with a raw key. */
export function isKeyEnvelope(data: Uint8Array): boolean {
  return startsWith(data, ECK1_MAGIC);
}

async function envelopeKeys(key: Uint8Array, salt: Uint8Array): Promise<{ key: CryptoKey; iv: Uint8Array }> {
  if (key.length !== KEY_ENVELOPE_BYTES) throw new Error('Invalid key');
  const base = await hkdfKey(key);
  const [aesKey, iv] = await Promise.all([
    hkdfAesKey(base, 'encrypt.click/key-envelope/v1/key', salt),
    hkdfBytes(base, 'encrypt.click/key-envelope/v1/iv', IV_BYTES, salt),
  ]);
  return { key: aesKey, iv };
}

/**
 * Magic and salt (8), then AES-256-GCM over the content with the header as AAD and a 128-bit tag. The IV is
 * derived, so the salt is what separates one seal from the next: every caller mints a fresh key and seals one
 * payload under it, so a key-and-IV repeat needs exactly the salt collision nobody grants an attacker. The
 * content is sealed unpadded, deliberately: chat attachments already carry their exact size inside the E2EE
 * message, and the blur a Padmé bucket would add is not worth the bytes the padding often costs.
 */
export async function sealWithKey(data: Uint8Array | Uint8Array[], key: Uint8Array): Promise<Uint8Array> {
  if (key.length !== KEY_ENVELOPE_BYTES) throw new Error('Invalid key');
  const parts = Array.isArray(data) ? data : [data];
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  if (length > 0xffff_ffff - 1) throw new Error('Input too large');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const { key: aesKey, iv } = await envelopeKeys(key, salt);
  const header = new Uint8Array(HEADER_LENGTH);
  header.set(ECK1_MAGIC);
  header.set(salt, ECK1_MAGIC.length);
  const content = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { content.set(part, offset); offset += part.length; }
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: header as BufferSource },
    aesKey,
    content as BufferSource,
  ));
  const result = new Uint8Array(HEADER_LENGTH + cipher.length);
  result.set(header);
  result.set(cipher, HEADER_LENGTH);
  return result;
}

export async function openWithKey(envelope: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (!startsWith(envelope, ECK1_MAGIC)) throw new Error('Unsupported encrypted data');
  if (envelope.length < HEADER_LENGTH + TAG_BYTES) throw new Error('Truncated encrypted data');
  const { key: aesKey, iv } = await envelopeKeys(key, envelope.subarray(ECK1_MAGIC.length, HEADER_LENGTH));
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: envelope.subarray(0, HEADER_LENGTH) as BufferSource },
    aesKey,
    envelope.subarray(HEADER_LENGTH) as BufferSource,
  ));
}
