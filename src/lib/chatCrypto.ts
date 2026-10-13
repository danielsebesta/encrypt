import { accessChannel } from './roomAccess';

const PBKDF2_ITERATIONS = 600_000;
const ED25519 = { name: 'Ed25519' };
const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;
const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function generateRoomKey(): Promise<string> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return arrayToB64url(key);
}

export async function deriveKeyFromPassword(password: string, roomId: string, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', bytesToArrayBuffer(enc.encode(password)), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: bytesToArrayBuffer(enc.encode(`encrypt.click:chat:${roomId}`)),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}


export async function hashChatChain(prevHash: string, record: unknown): Promise<string> {
  return arrayToB64url(await sha256Bytes(`${prevHash}\n${stableStringify(record)}`));
}

export type PersistentRoomAccess = { token: string; channel: string; key: CryptoKey };

// A saved room's secret is 32 random bytes, so a slow password hash would add nothing but delay;
// HKDF splits it into the access token the server checks and the message key it never sees.
export async function derivePersistentRoom(keyB64: string, roomId: string): Promise<PersistentRoomAccess> {
  const raw = b64urlToArray(keyB64);
  if (raw.length !== 32) throw new Error('Invalid room key');
  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey('raw', bytesToArrayBuffer(raw), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: bytesToArrayBuffer(enc.encode(`encrypt.click:chat-persistent:${roomId}`)),
    info: bytesToArrayBuffer(enc.encode(info)),
  });
  const tokenBytes = new Uint8Array(await crypto.subtle.deriveBits(params('access'), ikm, 256));
  const token = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.deriveKey(params('messages'), ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { token, channel: await accessChannel(token), key };
}

export type SigningIdentity = { publicKey: string; privateKey: CryptoKey };

// The private half is created non-extractable so it can be stored in IndexedDB but never read back as bytes.
export async function generateSigningIdentity(): Promise<SigningIdentity> {
  const pair = await crypto.subtle.generateKey(ED25519, false, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: arrayToB64url(raw), privateKey: pair.privateKey };
}

export function validPublicKey(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_KEY_RE.test(value);
}

// The signature covers the stable JSON of every field but itself, including the room and stamp fields.
export async function signPayload(identity: SigningIdentity, json: string): Promise<string> {
  const value = JSON.parse(json) as Record<string, unknown>;
  const unsigned: Record<string, unknown> = { ...value, _pk: identity.publicKey };
  delete unsigned._sig;
  const bytes = new TextEncoder().encode(stableStringify(unsigned));
  const sig = await crypto.subtle.sign(ED25519, identity.privateKey, bytesToArrayBuffer(bytes));
  return JSON.stringify({ ...unsigned, _sig: arrayToB64url(new Uint8Array(sig)) });
}

const verifyKeys = new Map<string, Promise<CryptoKey>>();

function verifyKey(publicKey: string): Promise<CryptoKey> {
  let key = verifyKeys.get(publicKey);
  if (!key) {
    key = crypto.subtle.importKey('raw', bytesToArrayBuffer(b64urlToArray(publicKey)), ED25519, false, ['verify']);
    verifyKeys.set(publicKey, key);
  }
  return key;
}

/** Returns the signer's public key when the payload carries a valid signature, otherwise null. */
export async function verifyPayload(value: unknown): Promise<string | null> {
  if (!value || typeof value !== 'object') return null;
  const { _sig, ...unsigned } = value as Record<string, unknown>;
  if (!validPublicKey(unsigned._pk) || typeof _sig !== 'string' || !SIGNATURE_RE.test(_sig)) return null;
  try {
    const bytes = new TextEncoder().encode(stableStringify(unsigned));
    const ok = await crypto.subtle.verify(ED25519, await verifyKey(unsigned._pk), bytesToArrayBuffer(b64urlToArray(_sig)), bytesToArrayBuffer(bytes));
    return ok ? unsigned._pk : null;
  } catch {
    return null;
  }
}

function digitGroups(bytes: Uint8Array, groups: number): string {
  const out: string[] = [];
  for (let i = 0; out.length < groups && i + 3 < bytes.length; i += 4) {
    const n = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    out.push(String(n % 100000).padStart(5, '0'));
  }
  return out.join(' ');
}

/** The same 20 digits on both sides when each holds the other's real public key. */
export async function safetyNumber(a: string, b: string): Promise<string> {
  return digitGroups(await sha256Bytes(`encrypt.click:chat-safety:${[a, b].sort().join(':')}`), 4);
}

export async function keyCode(publicKey: string): Promise<string> {
  return digitGroups(await sha256Bytes(`encrypt.click:chat-key:${publicKey}`), 2);
}

export async function importRoomKey(b64Key: string): Promise<CryptoKey> {
  const raw = b64urlToArray(b64Key);
  if (raw.length !== 32) throw new Error('Invalid room key');
  return crypto.subtle.importKey(
    'raw', bytesToArrayBuffer(raw), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(key: CryptoKey, plaintext: string): Promise<string> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytesToArrayBuffer(iv) },
    key,
    bytesToArrayBuffer(enc.encode(plaintext))
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
    { name: 'AES-GCM', iv: bytesToArrayBuffer(iv) },
    key,
    bytesToArrayBuffer(ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', bytesToArrayBuffer(enc.encode(input)));
  return new Uint8Array(digest);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
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
