import { generateSigningIdentity, validPublicKey, validSignerId, type SigningIdentity } from './chatCrypto';

const DB_NAME = 'encrypt.click:chat-identity';
const STORE = 'rooms';
const TRUST_PREFIX = 'encrypt.click:chat-trust:';
const PQ_SEED_SUFFIX = '#ml-dsa-44';
const SEED_BYTES = 32;

/** Alias key to the public keys that name has been accepted under. */
export type TrustTable = Record<string, string[]>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIdentity(db: IDBDatabase, room: string): Promise<SigningIdentity | null> {
  const value = await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(room)) as Partial<SigningIdentity> | undefined;
  return value && validPublicKey(value.publicKey) && value.privateKey instanceof CryptoKey ? { publicKey: value.publicKey, privateKey: value.privateKey } : null;
}

async function writeIdentity(db: IDBDatabase, room: string, identity: SigningIdentity): Promise<void> {
  await requestResult(db.transaction(STORE, 'readwrite').objectStore(STORE).put(identity, room));
}

/** One signing key per room per browser. Without IndexedDB (private windows) the key lasts for the page only. */
export async function loadRoomIdentity(room: string): Promise<SigningIdentity> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const existing = await readIdentity(db, room);
    if (existing) return existing;
  } catch {
    db = null;
  }
  const fresh = await generateSigningIdentity();
  if (db) {
    try { await writeIdentity(db, room, fresh); } catch {}
  }
  return fresh;
}

type SealedSeed = { v: 1; iv: Uint8Array; sealed: Uint8Array };

/**
 * The ML-DSA seed of a saved room. WebCrypto cannot hold ML-DSA keys, so the seed is stored sealed with AES-GCM under a key
 * derived from the room key: the database alone does not reveal it without the room link.
 */
export async function loadRoomPqSeed(room: string, sealKey: CryptoKey): Promise<Uint8Array> {
  const id = `${room}${PQ_SEED_SUFFIX}`;
  const additionalData = new TextEncoder().encode(`encrypt.click/chat/ml-dsa-seed\n${room}`);
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const stored = await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(id)) as Partial<SealedSeed> | undefined;
    if (stored?.v === 1 && stored.iv instanceof Uint8Array && stored.sealed instanceof Uint8Array) {
      try {
        const seed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv as BufferSource, additionalData }, sealKey, stored.sealed as BufferSource));
        if (seed.length === SEED_BYTES) return seed;
      } catch {}
    }
  } catch {
    db = null;
  }
  const seed = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
  if (db) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, sealKey, seed));
      await requestResult(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ v: 1, iv, sealed } satisfies SealedSeed, id));
    } catch {}
  }
  return seed;
}

export function loadTrustTable(room: string): TrustTable {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${TRUST_PREFIX}${room}`) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const table: TrustTable = {};
    for (const [name, keys] of Object.entries(parsed)) {
      if (Array.isArray(keys)) table[name] = keys.filter(validSignerId);
    }
    return table;
  } catch {
    return {};
  }
}

export function saveTrustTable(room: string, table: TrustTable) {
  try { localStorage.setItem(`${TRUST_PREFIX}${room}`, JSON.stringify(table)); } catch {}
}

export function forgetTrustTable(room: string) {
  try { localStorage.removeItem(`${TRUST_PREFIX}${room}`); } catch {}
}
