import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONS, OUTLINE } from '../src/lib/iconManifest';
import { TABLER, ICON_CREDIT } from '../src/lib/icons';
import { FILLED_EXTRAS } from '../src/lib/iconExtras';

const tabler = JSON.parse(
  readFileSync(new URL('../node_modules/@iconify-json/tabler/icons.json', import.meta.url), 'utf8'),
) as { icons: Record<string, { body: string }>; aliases?: Record<string, { parent: string }> };
Object.assign(tabler.icons, FILLED_EXTRAS);

function resolve(name: string): string | null {
  let current = name;
  for (let depth = 0; depth < 8; depth += 1) {
    if (tabler.icons[current]) return current;
    const parent = tabler.aliases?.[current]?.parent;
    if (!parent) return null;
    current = parent;
  }
  return null;
}

function chosen(key: keyof typeof ICONS): string {
  const base = ICONS[key];
  if (key in OUTLINE) {
    const outline = resolve(base);
    assert.ok(outline, `${key} outline ${base} missing`);
    return outline;
  }
  return resolve(`${base}-filled`) ?? resolve(base)!;
}

const FORCED_OUTLINE = [
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'chevron-up',
  'circle',
  'minus',
  'slash',
  'spline',
  'square-dashed',
] as const;

const NATURAL_OUTLINE = [
  'arrow-up-right',
  'at-sign',
  'audio-lines',
  'audio-waveform',
  'bring-to-front',
  'camera-off',
  'cloud-download',
  'code',
  'corner-down-left',
  'database-x',
  'eraser',
  'expand',
  'eye-off',
  'file-key',
  'file-lock',
  'fingerprint-pattern',
  'focus',
  'folder-key',
  'hand',
  'hash',
  'highlighter',
  'image-plus',
  'images',
  'infinity',
  'languages',
  'laser',
  'loader-circle',
  'lock-keyhole-open',
  'lock-open',
  'log-in',
  'maximize',
  'maximize-2',
  'mic-off',
  'minimize',
  'minimize-2',
  'monitor-up',
  'moon-star',
  'pen-tool',
  'pin-off',
  'qr-code',
  'redo-2',
  'refresh-cw',
  'reply',
  'rotate-ccw-clock',
  'rotate-ccw-key',
  'scan',
  'screen-share',
  'send-to-back',
  'share',
  'share-2',
  'smile-plus',
  'sticky-note',
  'timer-off',
  'type',
  'undo-2',
  'upload',
  'user-round-check',
  'user-round-pen',
  'user-x',
  'users',
  'venetian-mask',
  'vibrate',
  'video-off',
  'volume-1',
  'volume-2',
  'volume-x',
] as const;

test('every ICONS value resolves in @iconify-json/tabler', () => {
  for (const [key, name] of Object.entries(ICONS)) {
    assert.ok(resolve(name) || resolve(`${name}-filled`), `${key} -> ${name} missing`);
  }
});

test('filled variant is used unless the key is an explicit outline fallback', () => {
  assert.deepEqual(Object.keys(OUTLINE).sort(), [...FORCED_OUTLINE].sort());
  for (const key of FORCED_OUTLINE) {
    assert.equal(typeof OUTLINE[key], 'string');
    assert.ok(OUTLINE[key]!.trim().length > 20, key);
    const base = ICONS[key];
    assert.equal(chosen(key), resolve(base), key);
  }
  for (const key of Object.keys(ICONS) as (keyof typeof ICONS)[]) {
    if (key in OUTLINE) continue;
    const filled = resolve(`${ICONS[key]}-filled`);
    if (filled) assert.equal(chosen(key), filled, key);
  }
});

test('outline fallbacks with no filled variant are the listed set', () => {
  const natural = (Object.keys(ICONS) as (keyof typeof ICONS)[])
    .filter((key) => !(key in OUTLINE) && !resolve(`${ICONS[key]}-filled`))
    .sort();
  assert.deepEqual(natural, [...NATURAL_OUTLINE].sort());
});

test('generated TABLER bodies match the resolved package bodies', () => {
  assert.deepEqual(Object.keys(TABLER).sort(), Object.keys(ICONS).sort());
  for (const key of Object.keys(ICONS) as (keyof typeof ICONS)[]) {
    const icon = chosen(key);
    assert.equal(TABLER[key], tabler.icons[icon].body, `${key} -> ${icon}`);
    if (icon.endsWith('-filled')) assert.match(TABLER[key], /fill="currentColor"/, key);
  }
});

test('manifest does not import another icon set', () => {
  const source = readFileSync(new URL('../src/lib/iconManifest.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]lucide|from ['"]@iconify|from ['"]phosphor|from ['"]heroicons/);
  assert.doesNotMatch(source, /lucide-react|@phosphor-icons|@heroicons/);
});

test('ICON_CREDIT attributes Tabler Icons', () => {
  assert.equal(ICON_CREDIT.name, 'Tabler Icons');
  assert.equal(ICON_CREDIT.author, 'Paweł Kuna');
  assert.equal(ICON_CREDIT.license, 'MIT');
  assert.equal(ICON_CREDIT.licenseUrl, 'https://github.com/tabler/tabler-icons/blob/main/LICENSE');
  assert.equal(ICON_CREDIT.sourceUrl, 'https://github.com/tabler/tabler-icons');
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
    assert.doesNotMatch(text, /SOLAR\[|@iconify-json\/solar|ShapeGlyph/, file);
  }
  const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  assert.doesNotMatch(pkg, /lucide/i);
  assert.doesNotMatch(pkg, /@iconify-json\/solar/);
});
