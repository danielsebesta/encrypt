import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CACHE_VERSION,
  CONTRAST_PAIRS,
  SEED_PRESETS,
  cachedVars,
  computeAndCache,
  contrastRatio,
  isSeed,
  materialScheme,
} from '../src/lib/appTheme';

function memoryStorage() {
  const map = new Map<string, string>();
  const ls = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  return ls;
}

const SEEDS = [...SEED_PRESETS.map((p) => p.hex), '#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#808080'];

test('every seed yields AA on-roles in light and dark', () => {
  for (const seed of SEEDS) {
    for (const dark of [false, true]) {
      const scheme = materialScheme(seed, dark);
      for (const [fg, bg, min] of CONTRAST_PAIRS) {
        const ratio = contrastRatio(scheme[fg], scheme[bg]);
        assert.ok(ratio >= min, `${seed} ${dark ? 'dark' : 'light'} ${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
      }
    }
  }
});

test('scheme exposes every surface container role as hex', () => {
  const roles = ['surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest', 'surfaceDim', 'surfaceBright'] as const;
  for (const dark of [false, true]) {
    const scheme = materialScheme('#4a6fd1', dark);
    for (const role of roles) assert.match(scheme[role], /^#[0-9a-f]{6}$/);
  }
});

test('different seeds produce different primaries', () => {
  const primaries = new Set(SEED_PRESETS.map((p) => materialScheme(p.hex, false).primary));
  assert.equal(primaries.size, SEED_PRESETS.length);
});

test('isSeed accepts six digit hex only', () => {
  assert.ok(isSeed('#00838f'));
  assert.ok(!isSeed('00838f'));
  assert.ok(!isSeed('#fff'));
  assert.ok(!isSeed(42));
});

test('cache carries both schemes and rejects other versions', () => {
  const ls = memoryStorage();
  const out = computeAndCache('#c0392b');
  assert.equal(cachedVars()?.seed, '#c0392b');
  assert.ok(out.light['--md-sys-color-surface-container-high']);
  assert.ok(out.dark['--md-sys-color-on-primary']);
  ls.setItem('encrypt-app-mdvars', JSON.stringify({ ...out, v: 1 }));
  assert.equal(cachedVars(), null);
});

test('the /app boot script only applies a theme cache of the current version', () => {
  const boot = readFileSync(new URL('../src/pages/app/index.astro', import.meta.url), 'utf8');
  assert.ok(boot.includes(`cached.v !== ${CACHE_VERSION}`), 'index.astro boot script must check CACHE_VERSION');
});
