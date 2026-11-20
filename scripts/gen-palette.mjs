import { readFileSync, writeFileSync } from 'node:fs';
import { argbFromHex, hexFromArgb, Hct, SchemeTonalSpot, MaterialDynamicColors, TonalPalette } from '@material/material-color-utilities';

export const SITE_SEED = '#5f8f36';

const hex = (argb) => hexFromArgb(argb).toLowerCase();

function build(seed, dark) {
  const s = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), dark, 0);
  const night = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), true, 0);
  const nrole = (name) => hex(MaterialDynamicColors[name].getArgb(night));
  const role = (name) => hex(MaterialDynamicColors[name].getArgb(s));
  const pal = (p, light, night) => hex(p.tone(dark ? night : light));
  const primary = s.primaryPalette;
  const warn = TonalPalette.fromHueAndChroma(65, 72);
  return {
    '--bg': role('surface'),
    '--surface': role('surfaceContainerLow'),
    '--surface-2': role('surfaceContainer'),
    '--line': pal(s.neutralPalette, 89, 22),
    '--line-soft': pal(s.neutralPalette, 93, 17),
    '--control-line': role('outline'),
    '--text': role('onSurface'),
    '--muted': role('onSurfaceVariant'),
    '--accent': role('primary'),
    '--accent-strong': pal(primary, 25, 90),
    '--accent-weak': pal(s.secondaryPalette, 92, 20),
    '--accent-line': pal(s.secondaryPalette, 70, 30),
    '--on-accent': role('onPrimary'),
    '--warn': pal(warn, 38, 80),
    '--warn-weak': pal(warn, 95, 12),
    '--danger': role('error'),
    '--danger-weak': pal(s.errorPalette, 95, 15),
    '--call-bg': dark ? nrole('surfaceContainerLowest') : role('surfaceContainer'),
    '--call-surface': dark ? nrole('surfaceContainerLow') : role('surfaceContainerHighest'),
    '--call-surface-2': dark ? nrole('surfaceContainerHigh') : role('surfaceDim'),
    '--call-line': dark ? nrole('outlineVariant') : role('outlineVariant'),
    '--call-text': dark ? nrole('onSurface') : role('onSurface'),
    '--call-muted': dark ? nrole('onSurfaceVariant') : role('onSurfaceVariant'),
  };
}

export function palette(seed = SITE_SEED) {
  return { light: build(seed, false), dark: build(seed, true) };
}

const rgba = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${a})`;

export function iosAccent(seed = SITE_SEED) {
  const out = {};
  for (const dark of [false, true]) {
    const p = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), dark, 0).primaryPalette;
    const t = (tone) => hex(p.tone(tone));
    const tint = t(dark ? 80 : 40);
    const strong = t(dark ? 90 : 25);
    out[dark ? 'dark' : 'light'] = {
      '--app-tint': tint,
      '--app-on-tint': t(dark ? 20 : 100),
      '--app-tint-strong': strong,
      '--app-tint-container': rgba(tint, dark ? 0.17 : 0.14),
      '--app-on-tint-container': strong,
      '--app-bubble-mine': t(40),
      '--app-on-bubble-mine': t(100),
      '--k-color-primary': tint,
      '--k-color-brand-primary': tint,
      '--k-color-ios-primary': tint,
      '--k-color-ios-primary-tint': t(dark ? 90 : 50),
      '--k-color-ios-primary-shade': t(dark ? 70 : 30),
    };
  }
  return out;
}

export function themeColors(p) {
  return { light: p.light['--bg'], dark: p.dark['--bg'] };
}

const SEED = process.argv.slice(2).find((a) => a.startsWith('#')) || SITE_SEED;
const START = '/* palette:start */';
const END = '/* palette:end */';

function block(vars) {
  return Object.entries(vars).map(([k, v]) => `    ${k}: ${v};`).join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('gen-palette.mjs')) {
  const file = new URL('../src/styles/global.css', import.meta.url);
  let css = readFileSync(file, 'utf8');
  const { light, dark } = palette(SEED);
  if (process.argv.includes('--print')) {
    console.log(JSON.stringify({ light, dark }, null, 2));
  } else {
    const re = (scope) => new RegExp(`(${scope}\\s*\\{[^}]*?)${START.replace(/[/*]/g, '\\$&')}[\\s\\S]*?${END.replace(/[/*]/g, '\\$&')}`);
    for (const [scope, vars] of [[':root', light], ['html\\.dark', dark]]) {
      if (!re(scope).test(css)) throw new Error(`markers missing in ${scope}`);
      css = css.replace(re(scope), `$1${START}\n${block(vars)}\n    ${END}`);
    }
    writeFileSync(file, css);
    const appFile = new URL('../src/styles/app.css', import.meta.url);
    let app = readFileSync(appFile, 'utf8');
    const ios = iosAccent(SEED);
    const marker = (scope) => new RegExp(`(${scope}\\s*\\{[^}]*?)/\\* ios-accent:start \\*/[\\s\\S]*?/\\* ios-accent:end \\*/`);
    for (const [scope, vars] of [['\\[data-app-scheme="light"\\]', ios.light], [':root:not\\(\\[data-app-platform\\]\\)', ios.dark]]) {
      if (!marker(scope).test(app)) throw new Error(`ios-accent markers missing in ${scope}`);
      app = app.replace(marker(scope), `$1/* ios-accent:start */\n${block(vars)}\n    /* ios-accent:end */`);
    }
    writeFileSync(appFile, app);
    const root = (p) => new URL(p, import.meta.url);
    const tc = themeColors({ light, dark });
    const layout = root('../src/layouts/Layout.astro');
    writeFileSync(layout, readFileSync(layout, 'utf8')
      .replace(/(name="theme-color" content=")#[0-9a-f]{6}(" media="(prefers-color-scheme: light)")/i, `$1${tc.light}$2`)
      .replace(/(name="theme-color" content=")#[0-9a-f]{6}(" media="(prefers-color-scheme: dark)")/i, `$1${tc.dark}$2`));
    const manifest = root('../public/site.webmanifest');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(/("theme_color": ")#[0-9a-f]{6}/, `$1${tc.dark}`).replace(/("background_color": ")#[0-9a-f]{6}/, `$1${tc.dark}`));
    console.log('palette written for seed', SEED);
  }
}
