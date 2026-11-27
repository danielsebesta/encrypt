import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { palette, iosAccent, SITE_SEED } from '../scripts/gen-palette.mjs';
import { DEFAULT_SEED } from '../src/lib/appTheme';

type Palette = Record<string, string>;
const generated = palette() as { light: Palette; dark: Palette };
const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');

function hexRgb(value: string): [number, number, number] {
  const m = value.match(/^#([0-9a-f]{6})$/i);
  assert.ok(m, `expected #rrggbb, got ${value}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(value: string): number {
  const [r, g, b] = hexRgb(value).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function markedTokens(scope: RegExp): Palette {
  const rule = css.match(new RegExp(`${scope.source}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(rule, `rule ${scope.source} not found in global.css`);
  const body = rule[1].match(/\/\* palette:start \*\/([\s\S]*?)\/\* palette:end \*\//);
  assert.ok(body, `palette markers missing in ${scope.source}`);
  const tokens: Palette = {};
  for (const decl of body[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[decl[1]] = decl[2].trim();
  return tokens;
}

const REGENERATE = 'run: corepack pnpm exec tsx scripts/gen-palette.mjs';

for (const [mode, scope] of [['light', /:root/], ['dark', /html\.dark/]] as const) {
  test(`palette ${mode}: tokens in global.css match the generator output`, () => {
    assert.deepEqual(markedTokens(scope), generated[mode], `palette ${mode} was edited by hand; ${REGENERATE}`);
  });

  test(`palette ${mode}: required contrast pairs hold`, () => {
    const p = generated[mode];
    const pairs: [string, string, string, number][] = [
      ['text on bg', p['--text'], p['--bg'], 4.5],
      ['muted on bg', p['--muted'], p['--bg'], 4.5],
      ['accent on bg', p['--accent'], p['--bg'], 4.5],
      ['on-accent on accent', p['--on-accent'], p['--accent'], 4.5],
      ['control-line on bg', p['--control-line'], p['--bg'], 3],
    ];
    for (const [name, fg, bg, min] of pairs) {
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= min, `${mode}: ${name} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  });
}

test('the /app Material seed and iOS accent follow the site palette', () => {
  assert.equal(DEFAULT_SEED, SITE_SEED);
  const app = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  const blocks = [...app.matchAll(/\/\* ios-accent:start \*\/([\s\S]*?)\/\* ios-accent:end \*\//g)];
  assert.equal(blocks.length, 2, 'ios-accent markers missing in app.css');
  const expected = iosAccent() as { light: Palette; dark: Palette };
  [expected.light, expected.dark].forEach((want, i) => {
    const got: Palette = {};
    for (const decl of blocks[i][1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) got[decl[1]] = decl[2].trim();
    assert.deepEqual(got, want, 'app.css iOS accent is out of date: run corepack pnpm run build:palette');
  });
  assert.equal(expected.light['--app-tint'], generated.light['--accent']);
  assert.equal(expected.dark['--app-tint'], generated.dark['--accent']);
});
