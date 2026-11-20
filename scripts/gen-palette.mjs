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
    '--call-bg': nrole('surfaceContainerLowest'),
    '--call-surface': nrole('surfaceContainerLow'),
    '--call-surface-2': nrole('surfaceContainerHigh'),
    '--call-line': nrole('outlineVariant'),
    '--call-text': nrole('onSurface'),
    '--call-muted': nrole('onSurfaceVariant'),
  };
}

export function palette(seed = SITE_SEED) {
  return { light: build(seed, false), dark: build(seed, true) };
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
