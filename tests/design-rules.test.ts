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

test('interactive controls keep 44px targets on coarse pointers', () => {
  for (const selector of ['.btn,', '.nav__link {', '.menu__item {', '.tab,']) {
    const start = css.indexOf(selector);
    assert.ok(start >= 0, `missing ${selector}`);
    const body = css.slice(start, css.indexOf('}', start));
    assert.match(body, /min-h-11/, `${selector} lacks min-h-11`);
  }
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
  assert.match(coarse, /\.btn-sm[\s\S]*min-h-11/);
  assert.match(coarse, /\.btn-icon\.btn-sm[\s\S]*w-11/);
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
