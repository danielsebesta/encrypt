import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const css = read('src/styles/global.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(svelte|astro|css)$/.test(name)) out.push(full);
  }
  return out;
}

test('colour tokens meet WCAG AA contrast in both themes', () => {
  const output = execFileSync(process.execPath, [join(root, 'scripts/contrast-check.mjs')], { encoding: 'utf8' });
  assert.doesNotMatch(output, /FAIL/);
});

test('interactive controls are 40px, and 44px on coarse pointers', () => {
  const coarse = [...css.matchAll(/@media \(pointer: coarse\) \{([\s\S]*?)\n {4}\}/g)].map((m) => m[1]).join('\n');
  const cases: [string, RegExp, RegExp][] = [
    ['.btn', /\.btn,\n\s+\.btn-secondary,[\s\S]*?\{[^}]*min-h-10/, /\.btn-link\),\n\s+\.btn-sm \{\s*@apply min-h-11/],
    ['.nav__link', /\.nav__link \{[^}]*min-h-10/, /\.nav__link \{\s*@apply min-h-11/],
    ['.menu__item', /\.menu__item \{[^}]*min-h-10/, /\.menu__item \{\s*@apply min-h-11/],
    ['.tab', /\.tab \{[^}]*min-h-10/, /\.tab \{\s*@apply min-h-11/],
  ];
  for (const [name, base, touch] of cases) {
    assert.match(css, base, `${name} lacks min-h-10`);
    assert.match(coarse, touch, `${name} lacks min-h-11 on coarse pointers`);
  }
});


test('motion tokens are 100/180/320 ms', () => {
  assert.match(css, /--duration-fast:\s*100ms/);
  assert.match(css, /--duration-base:\s*180ms/);
  assert.match(css, /--duration-slow:\s*320ms/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('no gradients, glass, blur or pill radii in components and pages', () => {
  const files = [...walk(join(root, 'src/components')), ...walk(join(root, 'src/pages')), ...walk(join(root, 'src/layouts'))];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /(?<!mask-image: )(linear|radial|conic)-gradient\(/, `${file} has a gradient`);
    assert.doesNotMatch(text, /backdrop-filter:\s*(?!none)/, `${file} uses backdrop-filter`);
    assert.doesNotMatch(text, /\b(?:9{3,4}px)\b/, `${file} has a pill radius`);
    assert.doesNotMatch(text, /\bblur\(/, `${file} uses blur`);
  }
});
