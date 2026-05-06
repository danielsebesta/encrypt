import { encryptMessage, decryptMessage, generateIdentity, nameToGradient } from './chatCrypto';

const PBKDF2_ITERATIONS = 200_000;

export async function deriveKeyFromPassword(password: string, roomId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(`encrypt.click:whiteboard:${roomId}`),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<string> {
  return encryptMessage(key, bytesToB64(bytes));
}

export async function decryptBytes(key: CryptoKey, payload: string): Promise<Uint8Array> {
  const text = await decryptMessage(key, payload);
  return b64ToBytes(text);
}

function bytesToB64(arr: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(arr.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function b64ToBytes(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export { encryptMessage, decryptMessage, generateIdentity, nameToGradient };
