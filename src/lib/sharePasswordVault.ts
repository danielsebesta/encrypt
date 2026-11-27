import { parseShareFragment } from './shareLink';
import {
  unlockVault,
  unwrapSecret,
  vaultSessionKey,
  type WrappedSecret,
} from './roomVault';
import { deleteIdbDatabase } from './idbDelete';

const DB_NAME = 'encrypt.click:share-passwords';
const STORE = 'shares';

export type SharePasswordEntry = {
  id: string;
  label: string;
  createdAt: number;
  secret: WrappedSecret;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function sharePasswordId(fragment: string): Promise<string> {
  const link = parseShareFragment(fragment);
  const identity = link ? link.payload : fragment;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return [...new Uint8Array(digest).subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function forgetSharePasswords(): Promise<void> {
  await deleteIdbDatabase(DB_NAME);
}

export async function loadSharePassword(fragment: string): Promise<string | null> {
  try {
    if (!(await unlockVault())) return null;
    const key = vaultSessionKey();
    if (!key) return null;
    const id = await sharePasswordId(fragment);
    const entry = await withStore<SharePasswordEntry | undefined>('readonly', (s) => s.get(id));
    if (!entry?.secret) return null;
    const secret = await unwrapSecret(key, { id, mode: 'live', secret: entry.secret });
    return secret?.type === 'password' ? secret.value : null;
  } catch {
    return null;
  }
}
