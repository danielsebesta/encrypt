const SALT_SIZE = 16;
const IV_SIZE = 12;
const PBKDF2_ITERATIONS = 100000;
const ECLK_MAGIC = new Uint8Array([0x45, 0x43, 0x4c, 0x4b]);

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

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(data: Uint8Array, password: string, originalName?: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const key = await deriveKey(password, salt);
  
  const meta = JSON.stringify({ name: originalName || '', size: data.length });
  const metaBytes = new TextEncoder().encode(meta);
  const metaLen = new Uint8Array([metaBytes.length]);
  
  const payload = new Uint8Array(1 + metaBytes.length + data.length);
  payload.set(metaLen, 0);
  payload.set(metaBytes, 1);
  payload.set(data, 1 + metaBytes.length);
  
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, payload as BufferSource);
  const result = new Uint8Array(SALT_SIZE + IV_SIZE + ciphertext.byteLength);
  result.set(salt, 0);
  result.set(iv, SALT_SIZE);
  result.set(new Uint8Array(ciphertext), SALT_SIZE + IV_SIZE);
  return result;
}

export async function decryptData(encrypted: Uint8Array, password: string): Promise<{ data: Uint8Array; name: string }> {
  const salt = encrypted.slice(0, SALT_SIZE);
  const iv = encrypted.slice(SALT_SIZE, SALT_SIZE + IV_SIZE);
  const ciphertext = encrypted.slice(SALT_SIZE + IV_SIZE);
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource);
  const payload = new Uint8Array(plaintext);
  
  const metaLen = payload[0];
  const metaBytes = payload.slice(1, 1 + metaLen);
  const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as { name: string; size?: number };
  const data = payload.slice(1 + metaLen);
  
  return { data, name: meta.name || 'decrypted-file' };
}
