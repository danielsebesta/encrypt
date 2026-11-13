// WCAG AA check of the colour tokens in src/styles/global.css. Usage: node scripts/contrast-check.mjs
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const block = (selector) => {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Missing ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const tokens = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) tokens[m[1]] = m[2];
  return tokens;
};

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const pairs = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surface-2', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'surface-2', 4.5],
  ['accent', 'bg', 4.5], ['accent', 'surface', 4.5], ['accent-strong', 'bg', 4.5],
  ['accent', 'accent-weak', 4.5], ['text', 'accent-weak', 4.5], ['on-accent', 'accent', 4.5],
  ['warn', 'bg', 4.5], ['warn', 'warn-weak', 4.5], ['danger', 'bg', 4.5], ['danger', 'danger-weak', 4.5],
  ['control-line', 'bg', 3], ['control-line', 'surface', 3], ['accent', 'bg', 3],
];

let failures = 0;
for (const [name, selector] of [['light', ':root {\n    color-scheme: only light'], ['dark', 'html.dark {\n    color-scheme: only dark']]) {
  const t = block(selector);
  for (const [fg, bg, min] of pairs) {
    if (!t[fg] || !t[bg]) throw new Error(`${name}: token --${fg} or --${bg} missing`);
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} ${fg.padEnd(14)} on ${bg.padEnd(11)} ${r.toFixed(2)} (min ${min})`);
  }
}
if (failures) {
  console.error(`${failures} pair(s) below WCAG AA`);
  process.exit(1);
}
