type StoredIdentity = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
  fingerprint: string;
  name?: string;
  color?: string;
};

export type ChatSigningIdentity = StoredIdentity;

export type ChatPublicIdentity = {
  alg: 'ECDSA-P256-SHA256';
  fingerprint: string;
  publicJwk: JsonWebKey;
};

export type ChatSignature = {
  alg: 'ECDSA-P256-SHA256';
  value: string;
};

export type TrustedChatKey = {
  fingerprint: string;
  name: string;
  publicJwk: JsonWebKey;
  trustedAt: number;
};

const DB_NAME = 'encrypt-click-chat-identity';
const DB_VERSION = 1;
const STORE_IDENTITY = 'identity';
const STORE_TRUSTED = 'trusted';
const IDENTITY_KEY = 'default';
const SIGN_ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const VERIFY_ALG = { name: 'ECDSA', hash: 'SHA-256' } as const;

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', bytesToArrayBuffer(enc.encode(input)));
  return new Uint8Array(digest);
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_IDENTITY)) db.createObjectStore(STORE_IDENTITY);
      if (!db.objectStoreNames.contains(STORE_TRUSTED)) db.createObjectStore(STORE_TRUSTED, { keyPath: 'fingerprint' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function fingerprintPublicJwk(publicJwk: JsonWebKey): Promise<string> {
  const compact = {
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y,
  };
  return arrayToB64url(await sha256Bytes(stableStringify(compact))).slice(0, 22);
}

async function storeIdentity(identity: StoredIdentity): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_IDENTITY, 'readwrite');
  await idbRequest(tx.objectStore(STORE_IDENTITY).put(identity, IDENTITY_KEY));
  db.close();
}

async function makePrivateKeyNonExtractable(privateKey: CryptoKey): Promise<CryptoKey> {
  if (!privateKey.extractable) return privateKey;
  const privateJwk = await crypto.subtle.exportKey('jwk', privateKey);
  return crypto.subtle.importKey('jwk', privateJwk, SIGN_ALG, false, ['sign']);
}

export function formatChatFingerprint(fingerprint: string): string {
  return fingerprint.match(/.{1,4}/g)?.slice(0, 4).join(' ') ?? fingerprint;
}

type ChatIdentityProfile = {
  name: string;
  color: string;
};

export async function getOrCreateChatSigningIdentity(profile?: ChatIdentityProfile): Promise<ChatSigningIdentity> {
  const db = await openDb();
  const tx = db.transaction(STORE_IDENTITY, 'readonly');
  const existing = await idbRequest<StoredIdentity | undefined>(tx.objectStore(STORE_IDENTITY).get(IDENTITY_KEY));
  if (existing?.privateKey && existing?.publicKey && existing?.publicJwk && existing?.fingerprint) {
    db.close();
    const needsProfile = profile && (!existing.name || !existing.color);
    if (!existing.privateKey.extractable && !needsProfile) return existing;
    const hardened: StoredIdentity = {
      ...existing,
      privateKey: await makePrivateKeyNonExtractable(existing.privateKey),
      name: existing.name || profile?.name,
      color: existing.color || profile?.color,
    };
    await storeIdentity(hardened);
    return hardened;
  }
  db.close();

  const pair = await crypto.subtle.generateKey(SIGN_ALG, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const fingerprint = await fingerprintPublicJwk(publicJwk);
  const identity: StoredIdentity = {
    privateKey: await makePrivateKeyNonExtractable(pair.privateKey),
    publicKey: pair.publicKey,
    publicJwk,
    fingerprint,
    name: profile?.name,
    color: profile?.color,
  };

  await storeIdentity(identity);
  return identity;
}

export function publicIdentityFromSigningIdentity(identity: ChatSigningIdentity): ChatPublicIdentity {
  return {
    alg: 'ECDSA-P256-SHA256',
    fingerprint: identity.fingerprint,
    publicJwk: identity.publicJwk,
  };
}

export async function signChatRecord(identity: ChatSigningIdentity, record: unknown): Promise<ChatSignature> {
  const enc = new TextEncoder();
  const signature = await crypto.subtle.sign(VERIFY_ALG, identity.privateKey, enc.encode(stableStringify(record)));
  return {
    alg: 'ECDSA-P256-SHA256',
    value: arrayToB64url(new Uint8Array(signature)),
  };
}

export async function verifyChatSignature(publicIdentity: ChatPublicIdentity, signature: ChatSignature, record: unknown): Promise<boolean> {
  if (publicIdentity.alg !== 'ECDSA-P256-SHA256' || signature.alg !== 'ECDSA-P256-SHA256') return false;
  const expectedFingerprint = await fingerprintPublicJwk(publicIdentity.publicJwk);
  if (expectedFingerprint !== publicIdentity.fingerprint) return false;
  const publicKey = await crypto.subtle.importKey('jwk', publicIdentity.publicJwk, SIGN_ALG, false, ['verify']);
  const enc = new TextEncoder();
  return crypto.subtle.verify(VERIFY_ALG, publicKey, bytesToArrayBuffer(b64urlToArray(signature.value)), enc.encode(stableStringify(record)));
}

export async function listTrustedChatKeys(): Promise<TrustedChatKey[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_TRUSTED, 'readonly');
  const request = tx.objectStore(STORE_TRUSTED).getAll();
  const keys = await idbRequest<TrustedChatKey[]>(request);
  db.close();
  return keys;
}

export async function trustChatKey(key: Omit<TrustedChatKey, 'trustedAt'>): Promise<TrustedChatKey> {
  const trusted: TrustedChatKey = { ...key, trustedAt: Date.now() };
  const db = await openDb();
  const tx = db.transaction(STORE_TRUSTED, 'readwrite');
  await idbRequest(tx.objectStore(STORE_TRUSTED).put(trusted));
  db.close();
  return trusted;
}
