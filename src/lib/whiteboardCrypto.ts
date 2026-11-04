import { hkdfAesKey, hkdfBytes, hkdfKey } from './kdf';
import { roomSecret } from './roomAccess';

const VERSION = 3;
const SALT = 16;
const IV = 12;

export type BoardAccess = { token: string; channel: string; key: CryptoKey };

/** One Argon2id run gives the access token and the base key; each message is then sealed under its own HKDF subkey. */
export async function deriveBoardAccess(password: string, roomId: string): Promise<BoardAccess> {
  const { token, channel, base } = await roomSecret(password, roomId, 'whiteboard');
  return { token, channel, key: await boardMessageBase(base) };
}

export async function boardMessageBase(base: CryptoKey): Promise<CryptoKey> {
  return hkdfKey(await hkdfBytes(base, 'encrypt.click/whiteboard/v3/messages'));
}

// A random salt per message means a fresh AES-GCM key every time, so heavy cursor traffic never piles random IVs onto one key.
const messageKey = (base: CryptoKey, salt: Uint8Array) => hkdfAesKey(base, 'encrypt.click/whiteboard/v3/msg', salt);

/** [version (1) | salt (16) | iv (12) | AES-256-GCM ciphertext], with version and salt as AAD. */
export async function sealBoardMessage(base: CryptoKey, plaintext: string): Promise<string> {
  const head = new Uint8Array(1 + SALT);
  head[0] = VERSION;
  head.set(crypto.getRandomValues(new Uint8Array(SALT)), 1);
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const key = await messageKey(base, head.subarray(1));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: head }, key, new TextEncoder().encode(plaintext)));
  const out = new Uint8Array(head.length + IV + cipher.length);
  out.set(head);
  out.set(iv, head.length);
  out.set(cipher, head.length + IV);
  return bytesToB64(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function openBoardMessage(base: CryptoKey, payload: string): Promise<string> {
  const data = b64ToBytes(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
  if (data.length < 1 + SALT + IV + 16 || data[0] !== VERSION) throw new Error('Unsupported message');
  const head = data.slice(0, 1 + SALT);
  const key = await messageKey(base, head.subarray(1));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(head.length, head.length + IV), additionalData: head },
    key, data.subarray(head.length + IV) as BufferSource);
  return new TextDecoder().decode(plain);
}

export function bytesToB64(arr: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(arr.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export function b64ToBytes(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
