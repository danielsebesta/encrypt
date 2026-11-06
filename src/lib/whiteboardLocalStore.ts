import { deleteIdbDatabase } from './idbDelete';

const DB_NAME = 'encrypt.click:board-local';
const STORE = 'docs';
const RECORD_VERSION = 1;
const PANIC_FLAG = 'encrypt.click:panic-wipe';

export type LocalBoardRecord = { v: 1; sealed: string; at: number };

let suppressed = false;
let writeChain: Promise<void> = Promise.resolve();

/** Blocks further local saves for this page lifetime (panic wipe / sibling-tab wipe). */
export function suppressLocalBoards() {
  suppressed = true;
}

/** Re-enables local saves after a panic wipe finishes (flag must be cleared too). */
export function allowLocalBoards() {
  suppressed = false;
}

function panicActive(): boolean {
  try {
    return typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(PANIC_FLAG));
  } catch {
    return false;
  }
}

function enqueue(task: () => Promise<void>): Promise<void> {
  const next = writeChain.then(task, task);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

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

function validRecord(value: unknown): value is LocalBoardRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { v, sealed, at } = value as Record<string, unknown>;
  return v === RECORD_VERSION && typeof sealed === 'string' && sealed.length > 0 && typeof at === 'number' && Number.isFinite(at);
}

/** Loads the sealed Yjs snapshot for this access channel, if this browser still has one. */
export async function loadLocalBoard(channelId: string): Promise<LocalBoardRecord | null> {
  if (!channelId || typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb();
    try {
      const value = await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(channelId));
      return validRecord(value) ? value : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Overwrites the sealed snapshot for this channel. */
export async function saveLocalBoard(channelId: string, sealed: string): Promise<void> {
  if (panicActive()) suppressed = true;
  if (suppressed || !channelId || !sealed || typeof indexedDB === 'undefined') return;
  await enqueue(async () => {
    if (suppressed || panicActive()) {
      suppressed = true;
      return;
    }
    try {
      const db = await openDb();
      try {
        const record: LocalBoardRecord = { v: RECORD_VERSION, sealed, at: Date.now() };
        await requestResult(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, channelId));
      } finally {
        db.close();
      }
    } catch {}
  });
}

export async function clearLocalBoard(channelId: string): Promise<void> {
  if (!channelId || typeof indexedDB === 'undefined') return;
  await enqueue(async () => {
    try {
      const db = await openDb();
      try {
        await requestResult(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(channelId));
      } finally {
        db.close();
      }
    } catch {}
  });
}

/** Drops every sealed board snapshot kept on this device (panic wipe). */
export async function forgetLocalBoards(): Promise<void> {
  suppressed = true;
  await enqueue(async () => {
    await deleteIdbDatabase(DB_NAME);
  });
}
