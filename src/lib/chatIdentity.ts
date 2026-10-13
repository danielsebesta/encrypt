import { generateSigningIdentity, validPublicKey, type SigningIdentity } from './chatCrypto';

const DB_NAME = 'encrypt.click:chat-identity';
const STORE = 'rooms';
const TRUST_PREFIX = 'encrypt.click:chat-trust:';

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

export function loadTrustTable(room: string): TrustTable {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${TRUST_PREFIX}${room}`) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const table: TrustTable = {};
    for (const [name, keys] of Object.entries(parsed)) {
      if (Array.isArray(keys)) table[name] = keys.filter(validPublicKey);
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
