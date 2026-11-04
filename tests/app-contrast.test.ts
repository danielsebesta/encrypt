import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SEED, computeAndCache } from '../src/lib/appTheme';

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba | null {
  value = value.trim();
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  return null;
}

function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3] + bg[3] * (1 - fg[3]);
  if (a === 0) return [0, 0, 0, 0];
  const rgb = [0, 1, 2].map((i) => (fg[i] * fg[3] + bg[i] * bg[3] * (1 - fg[3])) / a);
  return [rgb[0], rgb[1], rgb[2], a];
}

function luminance(color: Rgba): number {
  const [r, g, b] = color.slice(0, 3).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fgValue: string, bgValue: string, pageValue: string): number {
  const fg = parseColor(fgValue)!;
  const page = parseColor(pageValue)!;
  // Translucent surfaces are composited over the page background first.
  const bg = composite(parseColor(bgValue)!, page);
  const l1 = luminance(composite(fg, bg));
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Foreground/background pairs every theme must keep readable.
const TEXT_PAIRS: [string, string, number][] = [
  ['--app-label', '--app-bg', 4.5],
  ['--app-label', '--app-surface', 4.5],
  ['--app-label-2', '--app-bg', 4.5],
  // Tertiary label only paints disabled controls and decorative icons — WCAG incidental, floored at 2:1.
  ['--app-label-3', '--app-bg', 2],
  ['--app-on-tint', '--app-tint', 4.5],
  ['--app-on-tint-container', '--app-tint-container', 4.5],
  ['--app-on-tint-weak', '--app-tint-weak', 4.5],
  ['--app-on-error-weak', '--app-error-weak', 4.5],
  ['--app-on-warn-weak', '--app-warn-weak', 4.5],
  ['--app-on-bubble', '--app-bubble', 4.5],
  ['--app-on-bubble-mine', '--app-bubble-mine', 4.5],
  ['--app-on-error', '--app-error', 4.5],
  ['--app-tint', '--app-bg', 3],
  ['--app-error', '--app-bg', 3],
];

function checkVars(vars: Record<string, string>, label: string) {
  for (const [fg, bg, min] of TEXT_PAIRS) {
    assert.ok(vars[fg] && vars[bg], `${label}: missing ${fg}/${bg}`);
    const ratio = contrast(vars[fg], vars[bg], vars['--app-bg']);
    assert.ok(ratio >= min, `${label}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 < ${min}:1`);
  }
}

test('Material You theme keeps WCAG contrast in light and dark', () => {
  const vars = computeAndCache(DEFAULT_SEED);
  checkVars(vars.light, 'material/light');
  checkVars(vars.dark, 'material/dark');
});

const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');

function iosVars(scheme: 'light' | 'dark'): Record<string, string> {
  const match = css.match(new RegExp(`data-app-platform="ios"\\]\\[data-app-scheme="${scheme}"[^\\{]*\\{([^}]*)\\}`));
  assert.ok(match, `ios ${scheme} token block not found`);
  const vars: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(/(--app-[a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[name] = value.trim();
  return vars;
}

test('iOS theme keeps WCAG contrast in light and dark', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const vars = iosVars(scheme);
    checkVars(vars, `ios/${scheme}`);
  }
});
