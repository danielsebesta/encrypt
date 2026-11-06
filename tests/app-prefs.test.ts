import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  loadDefaultRoomMode,
  loadHapticsMode,
  loadKeepAwake,
  loadLockTimeoutMs,
  loadReduceMotion,
  saveDefaultRoomMode,
  saveHapticsMode,
  saveKeepAwake,
  saveLockTimeoutMs,
  saveReduceMotion,
} from '../src/lib/appPrefs';

function stubLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  return store;
}

describe('app prefs', () => {
  it('migrates the legacy haptics toggle', () => {
    const store = stubLocalStorage();
    store.set('encrypt-app-haptics', '0');
    assert.equal(loadHapticsMode(), 'off');
    store.set('encrypt-app-haptics', '1');
    assert.equal(loadHapticsMode(), 'all');
    saveHapticsMode('essential');
    assert.equal(loadHapticsMode(), 'essential');
    assert.equal(store.get('encrypt-app-haptics'), '1');
  });

  it('defaults and persists lock timeout, keep-awake, room mode and motion', () => {
    stubLocalStorage();
    assert.equal(loadLockTimeoutMs(), DEFAULT_LOCK_TIMEOUT_MS);
    assert.equal(loadKeepAwake(), true);
    assert.equal(loadDefaultRoomMode(), 'live');
    assert.equal(loadReduceMotion(), false);

    saveLockTimeoutMs(300_000);
    saveKeepAwake(false);
    saveDefaultRoomMode('ttl');
    saveReduceMotion(true);

    assert.equal(loadLockTimeoutMs(), 300_000);
    assert.equal(loadKeepAwake(), false);
    assert.equal(loadDefaultRoomMode(), 'ttl');
    assert.equal(loadReduceMotion(), true);
  });
});
