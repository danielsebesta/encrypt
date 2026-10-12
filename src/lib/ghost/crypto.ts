import { sealPassword, openPassword, passwordKey } from '../passwordEnvelope';
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

export async function encryptData(data: Uint8Array, password: string, originalName = ''): Promise<Uint8Array> {
  const meta = new TextEncoder().encode(JSON.stringify({ name: originalName, size: data.length }));
  if (meta.length > 65536) throw new Error('Metadata too large');
  const payload = new Uint8Array(5 + meta.length + data.length);
  new DataView(payload.buffer).setUint32(1, meta.length);
  payload.set(meta, 5); payload.set(data, 5 + meta.length);
  return sealPassword(payload, password);
}

export async function decryptData(encrypted: Uint8Array, password: string): Promise<{ data: Uint8Array; name: string }> {
  const payload = await openPassword(encrypted, password);
  const parse = (offset: number, length: number) => {
    if (length < 2 || length > 65536 || offset + length > payload.length) throw new Error('Invalid metadata length');
    const meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload.slice(offset, offset + length)));
    const data = payload.slice(offset + length);
    if (!meta || typeof meta.name !== 'string' || !Number.isSafeInteger(meta.size) || meta.size !== data.length) throw new Error('Invalid metadata');
    return { data, name: meta.name || 'decrypted-file' };
  };
  if (payload.length >= 5 && payload[0] === 0) {
    try { return parse(5, new DataView(payload.buffer).getUint32(1)); } catch { /* Try authenticated legacy overflow. */ }
  }
  // Older writers wrapped the one-byte metadata length. Recovery is only attempted after GCM authentication.
  for (let length = payload[0]; length <= Math.min(65536, payload.length - 1); length += 256) {
    try { return parse(1, length); } catch { /* Try next wrapped length. */ }
  }
  throw new Error('Invalid encrypted file metadata');
}
