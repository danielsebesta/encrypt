/**
 * E2E Chat Encryption
 *
 * Two modes:
 * 1. Key-in-hash: Random AES key embedded in URL fragment (#)
 * 2. Password: AES key derived from password via PBKDF2
 */

const PBKDF2_ITERATIONS = 200_000;

export async function generateRoomKey(): Promise<string> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return arrayToB64url(key);
}

export async function deriveKeyFromPassword(password: string, roomId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(`encrypt.click:chat:${roomId}`),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function importRoomKey(b64Key: string): Promise<CryptoKey> {
  const raw = b64urlToArray(b64Key);
  return crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(key: CryptoKey, plaintext: string): Promise<string> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  // [iv(12) | ciphertext]
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);
  return arrayToB64url(combined);
}

export async function decryptMessage(key: CryptoKey, payload: string): Promise<string> {
  const data = b64urlToArray(payload);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

function arrayToB64url(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToArray(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Generate anonymous identity
const ADJECTIVES = ['Swift','Calm','Bold','Keen','Warm','Cool','Wise','Fair','Free','True'];
const ANIMALS = ['Fox','Owl','Bear','Wolf','Hawk','Deer','Lynx','Seal','Crow','Dove'];

export function generateIdentity(): { name: string; color: string } {
  const arr = crypto.getRandomValues(new Uint8Array(4));
  const adj = ADJECTIVES[arr[0] % ADJECTIVES.length];
  const animal = ANIMALS[arr[1] % ANIMALS.length];
  const hue = ((arr[2] << 8) | arr[3]) % 360;
  return {
    name: `${adj} ${animal}`,
    color: `hsl(${hue}, 65%, 55%)`,
  };
}
