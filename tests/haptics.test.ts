import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { modulateVibration, toVibratePattern, hapticsAvailable } from '../src/lib/haptics';

const original = {
  navigator: globalThis.navigator,
  window: globalThis.window,
};

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: original.navigator, configurable: true });
  if (original.window) Object.defineProperty(globalThis, 'window', { value: original.window, configurable: true });
});

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
