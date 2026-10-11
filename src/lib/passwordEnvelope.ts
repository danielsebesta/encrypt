const MAGIC = new Uint8Array([69, 67, 80, 50, 0, 9, 39, 192]); // ECP2, PBKDF2-SHA256 600000
export const PASSWORD_ENVELOPE_OVERHEAD = 52;

export async function passwordKey(password: string, salt: Uint8Array, iterations = 600_000): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealPassword(data: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, key, data as BufferSource));
  const result = new Uint8Array(36 + cipher.length);
  result.set(MAGIC); result.set(salt, 8); result.set(iv, 24); result.set(cipher, 36);
  return result;
}

export async function openPassword(data: Uint8Array, password: string): Promise<Uint8Array> {
  if (data.length < 44) throw new Error('Truncated encrypted data');
  const modern = MAGIC.every((byte, i) => data[i] === byte);
  const offset = modern ? 8 : 0;
  const key = await passwordKey(password, data.slice(offset, offset + 16), modern ? 600_000 : 100_000);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(offset + 16, offset + 28),
    ...(modern ? { additionalData: MAGIC } : {}) }, key, data.slice(offset + 28)));
}
