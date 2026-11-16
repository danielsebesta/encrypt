import { openChunkedFile } from '../chunkedFile';
import { b64urlToArray } from '../chatCrypto';
import { KEY_ENVELOPE_BYTES, openWithKey, sealWithKey, isKeyEnvelope } from '../keyEnvelope';
import { PASSWORD_ENVELOPE_OVERHEAD, sealPassword, openPassword } from '../passwordEnvelope';
import { FIRST_PARTY_ENVELOPE_LIMIT, SEND_ENVELOPE_LIMIT } from '../httpLimits';
export const ECLK_MAGIC = new Uint8Array([0x45, 0x43, 0x4c, 0x4b]);

export function prependEclkMagic(data: Uint8Array): Uint8Array {
  const combined = new Uint8Array(ECLK_MAGIC.length + data.length);
  combined.set(ECLK_MAGIC, 0);
  combined.set(data, ECLK_MAGIC.length);
  return combined;
}

// Padding stops at the first upload limit the unpadded file still fits under, so it never costs a destination.
const UPLOAD_CEILINGS = [SEND_ENVELOPE_LIMIT, FIRST_PARTY_ENVELOPE_LIMIT];

/** [0 | metadata length (u32) | JSON metadata | file bytes], sealed in one password envelope. */
export async function encryptData(data: Uint8Array, password: string, originalName = '', timeSecret?: Uint8Array): Promise<Uint8Array> {
  const meta = new TextEncoder().encode(JSON.stringify({ name: originalName, size: data.length }));
  if (meta.length > 65536) throw new Error('Metadata too large');
  const head = new Uint8Array(5);
  new DataView(head.buffer).setUint32(1, meta.length);
  const length = head.length + meta.length + data.length;
  const maxLength = UPLOAD_CEILINGS.find(limit => length + PASSWORD_ENVELOPE_OVERHEAD <= limit);
  return sealPassword([head, meta, data], password, { maxLength, timeSecret });
}

/**
 * The same payload under a raw 32-byte key (ECK1) instead of a password. For keys that travel inside an encrypted
 * message, a password envelope pays Argon2id per open and per send for nothing; this spends one HKDF in its place.
 * The key must come from the random source itself — the API takes bytes, so nothing a person types can be sealed
 * into the format that has no slow KDF behind it.
 */
export async function encryptDataWithKey(data: Uint8Array, key: Uint8Array, originalName = ''): Promise<Uint8Array> {
  if (key.length !== KEY_ENVELOPE_BYTES) throw new Error('Invalid file key');
  const meta = new TextEncoder().encode(JSON.stringify({ name: originalName, size: data.length }));
  if (meta.length > 65536) throw new Error('Metadata too large');
  const head = new Uint8Array(5);
  new DataView(head.buffer).setUint32(1, meta.length);
  return sealWithKey([head, meta, data], key);
}

function parseSealedPayload(payload: Uint8Array): { data: Uint8Array; name: string } {
  if (payload.length < 5 || payload[0] !== 0) throw new Error('Invalid encrypted file metadata');
  const length = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(1);
  if (length < 2 || length > 65536 || 5 + length > payload.length) throw new Error('Invalid metadata length');
  const meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload.slice(5, 5 + length)));
  const data = payload.slice(5 + length);
  if (!meta || typeof meta.name !== 'string' || !Number.isSafeInteger(meta.size) || meta.size !== data.length) throw new Error('Invalid metadata');
  return { data, name: meta.name || 'decrypted-file' };
}

async function decryptClassic(encrypted: Uint8Array, password: string, timeSecret?: Uint8Array): Promise<{ data: Uint8Array; name: string }> {
  return parseSealedPayload(await openPassword(encrypted, password, timeSecret));
}

async function decryptKeyFile(encrypted: Uint8Array, keyB64url: string): Promise<{ data: Uint8Array; name: string }> {
  let key: Uint8Array;
  try {
    key = b64urlToArray(keyB64url);
  } catch {
    throw new Error('Invalid file key');
  }
  if (key.length !== KEY_ENVELOPE_BYTES) throw new Error('Invalid file key');
  return parseSealedPayload(await openWithKey(encrypted, key));
}

/**
 * Opens a raw-key upload (ECK1), a classic single-envelope upload, or a chunked first-party download (manifest
 * envelope + AES-GCM parts). The ECK1 magic tells the key path apart; what is left tries classic before chunked,
 * so existing links stay on the fast path and trailing chunk bytes make the classic open fail cleanly.
 */
export async function decryptData(encrypted: Uint8Array, passwordOrKey: string, timeSecret?: Uint8Array): Promise<{ data: Uint8Array; name: string }> {
  if (isKeyEnvelope(encrypted)) {
    return decryptKeyFile(encrypted, passwordOrKey);
  }
  try {
    return await decryptClassic(encrypted, passwordOrKey, timeSecret);
  } catch (classic) {
    try {
      return await openChunkedFile(encrypted, passwordOrKey, timeSecret);
    } catch {
      throw classic;
    }
  }
}
