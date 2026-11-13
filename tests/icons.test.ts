import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONS, GAPS } from '../src/lib/iconManifest';
import { SOLAR, ICON_CREDIT } from '../src/lib/icons';

const solar = JSON.parse(
  readFileSync(new URL('../node_modules/@iconify-json/solar/icons.json', import.meta.url), 'utf8'),
) as { icons: Record<string, { body: string }>; aliases?: Record<string, { parent: string }> };

function resolve(name: string): string | null {
  let current = name;
  for (let depth = 0; depth < 8; depth += 1) {
    if (solar.icons[current]) return current;
    const parent = solar.aliases?.[current]?.parent;
    if (!parent) return null;
    current = parent;
  }
  return null;
}

test('every ICONS value resolves to a <name>-linear entry in @iconify-json/solar', () => {
  for (const [key, solarName] of Object.entries(ICONS)) {
    assert.ok(resolve(`${solarName}-linear`), `${key} -> ${solarName}-linear missing`);
  }
});

test('every Solar body is Linear style with stroke-width 1.5', () => {
  for (const [key, solarName] of Object.entries(ICONS)) {
    const body = solar.icons[resolve(`${solarName}-linear`)!].body;
    assert.ok(body.includes('stroke-width="1.5"'), `${key} body lacks stroke-width="1.5"`);
    if (resolve(`${solarName}-linear`) !== 'plain-linear') assert.ok(!body.includes('fill="currentColor"'), `${key} body fills with currentColor`);
  }
});

test('generated SOLAR bodies match the package bodies exactly', () => {
  assert.deepEqual(Object.keys(SOLAR).sort(), Object.keys(ICONS).sort());
  for (const [key, solarName] of Object.entries(ICONS)) {
    const body = solar.icons[resolve(`${solarName}-linear`)!].body;
    assert.equal(SOLAR[key as keyof typeof SOLAR], body, key);
  }
});

test('manifest imports nothing from lucide or other icon packages', () => {
  const source = readFileSync(new URL('../src/lib/iconManifest.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /lucide/i);
  assert.doesNotMatch(source, /phosphor/i);
  assert.doesNotMatch(source, /heroicons/i);
  assert.doesNotMatch(source, /tabler/i);
});

test('GAPS lists keys that are intentionally unmapped', () => {
  const iconKeys = new Set(Object.keys(ICONS));
  const gapKeys = new Set(GAPS.map((gap) => gap.key));
  assert.equal(gapKeys.size, GAPS.length, 'duplicate GAPS keys');
  for (const gap of GAPS) {
    assert.ok(!iconKeys.has(gap.key), `${gap.key} is both in ICONS and GAPS`);
    assert.ok(gap.reason.trim().length > 0, `${gap.key} has no reason`);
  }
});

test('ICON_CREDIT attributes the Solar Icon Set', () => {
  assert.equal(ICON_CREDIT.name, 'Solar Icon Set');
  assert.equal(ICON_CREDIT.author, '480 Design');
  assert.equal(ICON_CREDIT.license, 'CC BY 4.0');
  assert.equal(ICON_CREDIT.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
  assert.equal(ICON_CREDIT.sourceUrl, 'https://github.com/480-Design/Solar-Icon-Set');
});

test('no Lucide dependency, import or inline icon markup remains in src', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(svelte|astro|ts)$/.test(name)) files.push(full);
    }
  };
  walk(root);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /lucideIcons|@lucide|LUCIDE\[/, file);
  }
  const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  assert.doesNotMatch(pkg, /lucide/i);
});
