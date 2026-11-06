import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowLocalBoards,
  clearLocalBoard,
  forgetLocalBoards,
  loadLocalBoard,
  saveLocalBoard,
  suppressLocalBoards,
} from '../src/lib/whiteboardLocalStore';

/** Tiny in-memory IndexedDB stand-in so local board persistence can be tested in Node. */
function installMemoryIdb() {
  const dbs = new Map<string, Map<string, unknown>>();

  class MemRequest<T> {
    result!: T;
    error: DOMException | null = null;
    onsuccess: ((ev: Event) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    onupgradeneeded: ((ev: Event) => void) | null = null;
    onblocked: ((ev: Event) => void) | null = null;
    _succeed(value: T) {
      queueMicrotask(() => {
        this.result = value;
        this.onsuccess?.(new Event('success'));
      });
    }
  }

  class MemStore {
    constructor(private data: Map<string, unknown>) {}
    get(key: string) {
      const req = new MemRequest<unknown>();
      req._succeed(this.data.has(key) ? this.data.get(key) : undefined);
      return req as unknown as IDBRequest;
    }
    put(value: unknown, key: string) {
      this.data.set(String(key), value);
      const req = new MemRequest<unknown>();
      req._succeed(value);
      return req as unknown as IDBRequest;
    }
    delete(key: string) {
      this.data.delete(String(key));
      const req = new MemRequest<undefined>();
      req._succeed(undefined);
      return req as unknown as IDBRequest;
    }
  }

  class MemTx {
    constructor(private data: Map<string, unknown>) {}
    objectStore() {
      return new MemStore(this.data);
    }
  }

  class MemDb {
    objectStoreNames = { contains: () => true };
    constructor(private data: Map<string, unknown>) {}
    transaction() {
      return new MemTx(this.data);
    }
    close() {}
    createObjectStore() {
      return new MemStore(this.data);
    }
  }

  const indexedDB = {
    open(name: string) {
      const req = new MemRequest<MemDb>();
      const created = !dbs.has(name);
      if (created) dbs.set(name, new Map());
      const db = new MemDb(dbs.get(name)!);
      queueMicrotask(() => {
        req.result = db;
        if (created) req.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent);
        req.onsuccess?.(new Event('success'));
      });
      return req as unknown as IDBOpenDBRequest;
    },
    deleteDatabase(name: string) {
      dbs.delete(name);
      const req = new MemRequest<undefined>();
      req._succeed(undefined);
      return req as unknown as IDBOpenDBRequest;
    },
  };

  Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
}

beforeEach(() => {
  allowLocalBoards();
  installMemoryIdb();
  try {
    localStorage.removeItem('encrypt.click:panic-wipe');
  } catch {}
});

test('sealed board snapshots round-trip in the local store', async () => {
  const channel = 'a'.repeat(64);
  await saveLocalBoard(channel, 'sealed-payload-one');
  const loaded = await loadLocalBoard(channel);
  assert.ok(loaded);
  assert.equal(loaded!.v, 1);
  assert.equal(loaded!.sealed, 'sealed-payload-one');
  assert.ok(Number.isFinite(loaded!.at));
});

test('clearing one channel leaves others alone', async () => {
  await saveLocalBoard('chan-a', 'aaa');
  await saveLocalBoard('chan-b', 'bbb');
  await clearLocalBoard('chan-a');
  assert.equal(await loadLocalBoard('chan-a'), null);
  assert.equal((await loadLocalBoard('chan-b'))?.sealed, 'bbb');
});

test('panic suppression blocks saves until allowLocalBoards', async () => {
  const channel = 'p'.repeat(64);
  await saveLocalBoard(channel, 'before');
  suppressLocalBoards();
  await saveLocalBoard(channel, 'during-panic');
  assert.equal((await loadLocalBoard(channel))?.sealed, 'before');
  allowLocalBoards();
  await saveLocalBoard(channel, 'after');
  assert.equal((await loadLocalBoard(channel))?.sealed, 'after');
});

test('forgetLocalBoards drops the database', async () => {
  await saveLocalBoard('x'.repeat(64), 'gone');
  await forgetLocalBoards();
  allowLocalBoards();
  assert.equal(await loadLocalBoard('x'.repeat(64)), null);
});
