import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ENCRYPT_PALETTES,
  SHAPES,
  SHAPE_COUNT,
  contrastRatio,
  identiconSvg,
  identiconDataUri,
  identiconBackground,
  sha256Sync
} from '../src/lib/identicon';

test('sha256Sync matches node crypto and is deterministic', () => {
  for (const s of ['', 'hello', 'a'.repeat(55), 'a'.repeat(64), 'Hbitá Vydra']) {
    assert.deepEqual(Buffer.from(sha256Sync(s)), createHash('sha256').update(s).digest());
  }
});

test('identiconSvg returns a well-formed SVG', () => {
  const svg = identiconSvg({ key: 'abc', name: 'Alice' }, 32);
  assert.ok(svg.startsWith('<svg viewBox="0 0 100 100" width="32" height="32"'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes('<rect width="100" height="100"'));
  assert.ok(!svg.includes('NaN') && !svg.includes('undefined'));
});

test('identiconSvg accepts alias objects, key and name, or strings', () => {
  assert.equal(identiconSvg('alias:2-18-0'), identiconSvg({ a: 2, n: 18, h: 0 }));
  assert.equal(identiconSvg({ key: 'k', name: 'n' }), identiconSvg('k:n'));
});

test('identiconDataUri and identiconBackground wrap the svg', () => {
  assert.ok(identiconDataUri('Bob').startsWith('data:image/svg+xml,%3Csvg'));
  const bg = identiconBackground('Bob');
  assert.ok(bg.startsWith('url("data:image/svg+xml,'));
  assert.ok(bg.endsWith('") center / cover no-repeat'));
});

test('distinct key and name pairs give distinct avatars', () => {
  const svgs = new Set(Array.from({ length: 300 }, (_, i) => identiconSvg({ key: `key${i}`, name: 'Alice' })));
  assert.ok(svgs.size >= 299);
});

test('palettes are valid and all shapes render within one cell', () => {
  for (const p of ENCRYPT_PALETTES) {
    assert.equal(p.colors.length, 5);
    for (const c of p.colors) assert.match(c, /^#[0-9a-f]{6}$/);
  }
  assert.equal(new Set(ENCRYPT_PALETTES.map((p) => p.name)).size, ENCRYPT_PALETTES.length);
  assert.equal(new Set(SHAPES.map((s) => s.name)).size, SHAPE_COUNT);
  for (const s of SHAPES) {
    const out = s.draw('#111111', '#eeeeee');
    assert.ok(out.length > 0 && !out.includes('NaN') && !out.includes('undefined'), s.name);
  }
});

test('shape and background colors stay readable in every generated avatar', () => {
  const pairs = ENCRYPT_PALETTES.flatMap((p) => p.colors.flatMap((a) => p.colors.filter((b) => b !== a).map((b) => contrastRatio(a, b))));
  assert.ok(Math.max(...pairs) >= 1.6);
  for (let i = 0; i < 2000; i++) {
    const svg = identiconSvg({ key: `k${i}`, name: `n${i}` });
    assert.ok(svg.includes('<g transform='));
  }
});
