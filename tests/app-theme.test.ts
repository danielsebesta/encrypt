import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SEED,
  cachedVars,
  computeAndCache,
  detectPlatform,
  loadThemeState,
  resolveScheme,
} from '../src/lib/appTheme';

type Store = Map<string, string>;

function stubLocalStorage(): Store {
  const store: Store = new Map();
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

function stubMatchMedia(lightMatches: boolean) {
  const mm = (query: string) => ({
    matches: query.includes('light') ? lightMatches : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  });
  Object.defineProperty(globalThis, 'window', {
    value: { matchMedia: mm },
    configurable: true,
    writable: true,
  });
}

test('detectPlatform returns ios without a navigator and material for Android', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });
    assert.equal(detectPlatform(), 'ios');
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' },
      configurable: true,
      writable: true,
    });
    assert.equal(detectPlatform(), 'material');
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)' },
      configurable: true,
      writable: true,
    });
    assert.equal(detectPlatform(), 'ios');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
  }
});

test('resolveScheme honours explicit choice and falls back to dark for system', () => {
  assert.equal(resolveScheme('light'), 'light');
  assert.equal(resolveScheme('dark'), 'dark');
  stubMatchMedia(false);
  assert.equal(resolveScheme('system'), 'dark');
  stubMatchMedia(true);
  assert.equal(resolveScheme('system'), 'light');
});

test('loadThemeState ignores stored overrides and clears them', () => {
  const store = stubLocalStorage();
  stubMatchMedia(false);
  store.set('encrypt-app-platform', 'material');
  store.set('encrypt-app-appearance', 'dark');
  store.set('encrypt-app-seed', '#112233');
  const state = loadThemeState();
  assert.equal(state.appearance, 'system');
  assert.equal(state.seed, DEFAULT_SEED);
  assert.equal(state.platform, detectPlatform());
  assert.equal(store.has('encrypt-app-platform'), false);
  assert.equal(store.has('encrypt-app-appearance'), false);
  assert.equal(store.has('encrypt-app-seed'), false);
});

const HEX_RE = /^#[0-9a-f]{6}$/i;

test('computeAndCache produces complete hex MD3 role sets for every seed', () => {
  stubLocalStorage();
  for (const hex of [DEFAULT_SEED, '#6b9ce8']) {
    const out = computeAndCache(hex);
    for (const mode of ['light', 'dark'] as const) {
      const vars = out[mode];
      for (const role of [
        '--k-color-md-' + (mode === 'dark' ? 'dark' : 'light') + '-primary',
        '--k-color-md-' + (mode === 'dark' ? 'dark' : 'light') + '-on-primary',
        '--app-bg',
        '--app-label',
        '--app-tint',
        '--app-separator',
      ]) {
        assert.ok(vars[role], `${hex} ${mode} missing ${role}`);
        assert.match(vars[role], HEX_RE, `${hex} ${mode} ${role} = ${vars[role]}`);
      }
      assert.match(vars['--app-scrim'], /^color-mix\(/);
    }
    const cached = cachedVars();
    assert.ok(cached);
    assert.equal(cached!.seed, hex);
    assert.deepEqual(cached!.light, out.light);
  }
});

test('different seeds produce different primary colors, same seed is stable', () => {
  stubLocalStorage();
  const a = computeAndCache('#86b94a');
  const b = computeAndCache('#6b9ce8');
  const a2 = computeAndCache('#86b94a');
  assert.notEqual(a.light['--k-color-md-light-primary'], b.light['--k-color-md-light-primary']);
  assert.equal(a.light['--k-color-md-light-primary'], a2.light['--k-color-md-light-primary']);
});

test('cachedVars returns null for missing or corrupt storage', () => {
  const store = stubLocalStorage();
  assert.equal(cachedVars(), null);
  store.set('encrypt-app-mdvars', '{not json');
  assert.equal(cachedVars(), null);
  store.set('encrypt-app-mdvars', JSON.stringify({ seed: 42, light: {}, dark: {} }));
  assert.equal(cachedVars(), null);
});
