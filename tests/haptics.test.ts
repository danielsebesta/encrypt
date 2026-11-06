import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  modulateVibration,
  toVibratePattern,
  hapticsAvailable,
  hapticAllowed,
  haptic,
  noteNativeHapticTick,
} from '../src/lib/haptics';

const original = {
  navigator: globalThis.navigator,
  window: globalThis.window,
  localStorage: (globalThis as { localStorage?: unknown }).localStorage,
};

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: original.navigator, configurable: true });
  if (original.window) Object.defineProperty(globalThis, 'window', { value: original.window, configurable: true });
  if (original.localStorage !== undefined) {
    Object.defineProperty(globalThis, 'localStorage', { value: original.localStorage, configurable: true, writable: true });
  } else {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
  }
});

function stubLocalStorage(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
}

function stubEnv(opts: {
  vibrate?: unknown;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  coarse?: boolean;
}) {
  const nav = {
    vibrate: opts.vibrate,
    userAgent: opts.userAgent ?? 'Mozilla/5.0',
    platform: opts.platform ?? 'Win32',
    maxTouchPoints: opts.maxTouchPoints ?? 0,
  };
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
  Object.defineProperty(globalThis, 'window', {
    value: {
      matchMedia: (q: string) => ({
        matches: opts.coarse === true && q.includes('pointer: coarse'),
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }),
    },
    configurable: true,
  });
}

test('haptics are offered on iPhone even without vibrate()', () => {
  stubEnv({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
  assert.equal(hapticsAvailable(), true);
});

test('haptics are offered on Android with vibrate() and a coarse pointer', () => {
  stubEnv({
    vibrate: () => true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    coarse: true,
  });
  assert.equal(hapticsAvailable(), true);
});

test('haptics are hidden on desktop Chrome that exposes a no-op vibrate()', () => {
  stubEnv({
    vibrate: () => true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
    coarse: false,
  });
  assert.equal(hapticsAvailable(), false);
});

test('full intensity is a single on segment', () => {
  assert.deepEqual(modulateVibration(40, 1), [40]);
  assert.deepEqual(modulateVibration(40, 0), []);
});

test('half intensity uses a 20ms PWM duty cycle', () => {
  assert.deepEqual(modulateVibration(40, 0.5), [10, 10, 10, 10]);
});

test('toVibratePattern merges delay into the off gap between pulses', () => {
  assert.deepEqual(
    toVibratePattern([
      { duration: 30, intensity: 1 },
      { delay: 60, duration: 40, intensity: 1 },
    ]),
    [30, 60, 40],
  );
});

test('hapticAllowed follows the preference mode', () => {
  stubLocalStorage({ 'encrypt-app-haptics-mode': 'off' });
  assert.equal(hapticAllowed('medium'), false);
  stubLocalStorage({ 'encrypt-app-haptics-mode': 'essential' });
  assert.equal(hapticAllowed('light'), false);
  assert.equal(hapticAllowed('medium'), true);
  stubLocalStorage({ 'encrypt-app-haptics-mode': 'all' });
  assert.equal(hapticAllowed('light'), true);
});

test('a native overlay tick suppresses the programmatic haptic in the same tap', () => {
  stubLocalStorage({ 'encrypt-app-haptics-mode': 'all' });
  const calls: number[][] = [];
  stubEnv({
    vibrate: (pattern: number | number[]) => {
      calls.push(typeof pattern === 'number' ? [pattern] : pattern);
      return true;
    },
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    coarse: true,
  });
  haptic('light');
  assert.equal(calls.length, 1, 'vibrates without a native tick');
  noteNativeHapticTick();
  haptic('light');
  assert.equal(calls.length, 1, 'the overlay tick already fired the system haptic');
});
