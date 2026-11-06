import { parseShareFragment } from './shareLink';
import {
  createPasskey,
  unlockVault,
  unwrapSecret,
  vaultSessionKey,
  vaultState,
  wrapSecret,
  type WrappedSecret,
} from './roomVault';
import { deleteIdbDatabase } from './idbDelete';

const DB_NAME = 'encrypt.click:share-passwords';
const STORE = 'shares';
const LABEL_MAX = 64;

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
  // Optional params (burn, expiry, time-lock) reshape the link but not the share inside it, so the saved
  // password is keyed by the payload — the same secret unlocks every variant of that share.
  const link = parseShareFragment(fragment);
  const identity = link ? link.payload : fragment;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return [...new Uint8Array(digest).subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanLabel(value: string, fallback: string): string {
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  return [...(text || fallback)].slice(0, LABEL_MAX).join('');
}

/** Wrap a share password under the room vault passkey (same PRF session). */
export async function saveSharePassword(
  fragment: string,
  password: string,
  label: string,
  passkeyName: string,
): Promise<'saved' | 'cancelled' | 'failed' | 'no-prf' | 'names'> {
  try {
    if (!password || password.length > 1024) return 'failed';
    const state = await vaultState();
    if (state === 'names') return 'names';
    if (state === 'new') {
      const created = await createPasskey(passkeyName);
      if (created === 'cancelled') return 'cancelled';
      if (created === 'failed') return 'failed';
      if (created === 'no-prf') return 'no-prf';
    }
    if (!(await unlockVault())) return 'cancelled';
    const key = vaultSessionKey();
    if (!key) return 'failed';
    const id = await sharePasswordId(fragment);
    const secret = await wrapSecret(key, id, { type: 'password', value: password });
    const entry: SharePasswordEntry = {
      id,
      label: cleanLabel(label, id.slice(0, 8)),
      createdAt: Date.now(),
      secret,
    };
    await withStore('readwrite', (s) => s.put(entry));
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** Drops every saved share password on this device (entries are vault-wrapped; the panic wipe removes both). */
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
