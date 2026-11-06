/** App-level preferences persisted in localStorage (device-local only). */

export type HapticsMode = 'off' | 'essential' | 'all';
export type DefaultRoomMode = 'live' | 'ttl';
export type LockTimeoutMs = 0 | 30_000 | 60_000 | 300_000;

export const LOCK_TIMEOUT_OPTIONS: readonly LockTimeoutMs[] = [0, 30_000, 60_000, 300_000];
export const DEFAULT_LOCK_TIMEOUT_MS: LockTimeoutMs = 30_000;

const LS_HAPTICS_LEGACY = 'encrypt-app-haptics';
const LS_HAPTICS_MODE = 'encrypt-app-haptics-mode';
const LS_LOCK_TIMEOUT = 'encrypt-app-lock-timeout';
const LS_KEEP_AWAKE = 'encrypt-app-keep-awake';
const LS_DEFAULT_ROOM = 'encrypt-app-default-room-mode';
const LS_REDUCE_MOTION = 'encrypt-app-reduce-motion';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function loadHapticsMode(): HapticsMode {
  const mode = read(LS_HAPTICS_MODE);
  if (mode === 'off' || mode === 'essential' || mode === 'all') return mode;
  return read(LS_HAPTICS_LEGACY) === '0' ? 'off' : 'all';
}

export function saveHapticsMode(mode: HapticsMode) {
  write(LS_HAPTICS_MODE, mode);
  write(LS_HAPTICS_LEGACY, mode === 'off' ? '0' : '1');
}

export function loadLockTimeoutMs(): LockTimeoutMs {
  const stored = read(LS_LOCK_TIMEOUT);
  if (stored == null) return DEFAULT_LOCK_TIMEOUT_MS;
  const raw = Number(stored);
  return (LOCK_TIMEOUT_OPTIONS as readonly number[]).includes(raw)
    ? (raw as LockTimeoutMs)
    : DEFAULT_LOCK_TIMEOUT_MS;
}

export function saveLockTimeoutMs(ms: LockTimeoutMs) {
  write(LS_LOCK_TIMEOUT, String(ms));
}

export function loadKeepAwake(): boolean {
  return read(LS_KEEP_AWAKE) !== '0';
}

export function saveKeepAwake(on: boolean) {
  write(LS_KEEP_AWAKE, on ? '1' : '0');
}

export function loadDefaultRoomMode(): DefaultRoomMode {
  return read(LS_DEFAULT_ROOM) === 'ttl' ? 'ttl' : 'live';
}

export function saveDefaultRoomMode(mode: DefaultRoomMode) {
  write(LS_DEFAULT_ROOM, mode);
}

export function loadReduceMotion(): boolean {
  return read(LS_REDUCE_MOTION) === '1';
}

export function saveReduceMotion(on: boolean) {
  write(LS_REDUCE_MOTION, on ? '1' : '0');
}

export function applyReduceMotion(on: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.appReduceMotion = on ? '1' : '0';
}

export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.appReduceMotion === '1') return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Clears SW caches and unregisters workers — does not touch vault / room secrets. */
export async function clearAppCaches(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.unregister().catch(() => {});
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('encrypt-')).map((key) => caches.delete(key)));
    return true;
  } catch {
    return false;
  }
}
