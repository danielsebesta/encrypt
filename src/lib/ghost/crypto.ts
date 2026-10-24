import { PASSWORD_ENVELOPE_OVERHEAD, sealPassword, openPasswordEnvelope, passwordKey } from '../passwordEnvelope';
import { FIRST_PARTY_ENVELOPE_LIMIT, SEND_ENVELOPE_LIMIT } from '../httpLimits';
export const ECLK_MAGIC = new Uint8Array([0x45, 0x43, 0x4c, 0x4b]);

export function prependEclkMagic(data: Uint8Array): Uint8Array {
  const combined = new Uint8Array(ECLK_MAGIC.length + data.length);
  combined.set(ECLK_MAGIC, 0);
  combined.set(data, ECLK_MAGIC.length);
  return combined;
}

export function hasEclkMagic(data: Uint8Array): boolean {
  if (data.length < ECLK_MAGIC.length) return false;
  for (let i = 0; i < ECLK_MAGIC.length; i++) {
    if (data[i] !== ECLK_MAGIC[i]) return false;
  }
  return true;
}

export function stripEclkMagic(data: Uint8Array): Uint8Array {
  return hasEclkMagic(data) ? data.slice(ECLK_MAGIC.length) : data;
}

export const deriveKey = (password: string, salt: Uint8Array) => passwordKey(password, salt, 100_000);

// Padding stops at the first upload limit the unpadded file still fits under, so it never costs a destination.
const UPLOAD_CEILINGS = [SEND_ENVELOPE_LIMIT, FIRST_PARTY_ENVELOPE_LIMIT];

export async function encryptData(data: Uint8Array, password: string, originalName = ''): Promise<Uint8Array> {
  const meta = new TextEncoder().encode(JSON.stringify({ name: originalName, size: data.length }));
  if (meta.length > 65536) throw new Error('Metadata too large');
  const head = new Uint8Array(5);
  new DataView(head.buffer).setUint32(1, meta.length);
  const length = head.length + meta.length + data.length;
  const maxLength = UPLOAD_CEILINGS.find(limit => length + PASSWORD_ENVELOPE_OVERHEAD <= limit);
  return sealPassword([head, meta, data], password, { maxLength });
}

export async function decryptData(encrypted: Uint8Array, password: string): Promise<{ data: Uint8Array; name: string }> {
  const { plaintext: payload, version } = await openPasswordEnvelope(encrypted, password);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const parse = (offset: number, length: number) => {
    if (length < 2 || length > 65536 || offset + length > payload.length) throw new Error('Invalid metadata length');
    const meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload.slice(offset, offset + length)));
    const data = payload.slice(offset + length);
    if (!meta || typeof meta.name !== 'string' || !Number.isSafeInteger(meta.size) || meta.size !== data.length) throw new Error('Invalid metadata');
    return { data, name: meta.name || 'decrypted-file' };
  };
  if (payload.length >= 5 && payload[0] === 0) {
    try { return parse(5, view.getUint32(1)); } catch (error) { if (version === 3) throw error; }
  }
  if (version === 3) throw new Error('Invalid encrypted file metadata');
  // Older writers wrapped the one-byte metadata length. Recovery is only attempted after GCM authentication.
  for (let length = payload[0]; length <= Math.min(65536, payload.length - 1); length += 256) {
    try { return parse(1, length); } catch { /* Try next wrapped length. */ }
  }
  throw new Error('Invalid encrypted file metadata');
}
