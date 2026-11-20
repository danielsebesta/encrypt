import {
  argbFromHex,
  hexFromArgb,
  Contrast,
  Hct,
  SchemeTonalSpot,
  MaterialDynamicColors,
  DynamicColor,
} from '@material/material-color-utilities';

export type AppPlatform = 'ios' | 'material';
export type AppScheme = 'light' | 'dark';
export type AppAppearance = 'system' | AppScheme;

// Neutral slate seed: low chroma (HCT ~13) at a cool blue-grey hue, so the generated
// Material roles read as technical chrome instead of a brand colour. SchemeTonalSpot
// fixes the primary/secondary/tertiary chroma, so the seed's hue is what sets the tint.
export const DEFAULT_SEED = '#5b6472';

export const SEED_PRESETS = [
  { id: 'slate', hex: DEFAULT_SEED },
  { id: 'blue', hex: '#4a6fd1' },
  { id: 'teal', hex: '#00838f' },
  { id: 'green', hex: '#3d8a3a' },
  { id: 'yellow', hex: '#c49a00' },
  { id: 'orange', hex: '#d0632b' },
  { id: 'red', hex: '#c0392b' },
  { id: 'purple', hex: '#8a4fbf' },
] as const;

export type SeedPresetId = (typeof SEED_PRESETS)[number]['id'];

const SPEC_VERSION = '2025';

// Warning roles are not part of the M3 scheme; one fixed amber pair per scheme.
const WARN = {
  light: { warn: '#8a5a00', weak: '#f7e3ab', onWeak: '#554000' },
  dark: { warn: '#f2bf45', weak: '#443400', onWeak: '#f7e3ab' },
} as const;

const AMOLED_BLACK = '#000000';

const CACHE_VERSION = 2;

const LS_MD_VARS = 'encrypt-app-mdvars';
const LS_PLATFORM = 'encrypt-app-platform';
const LS_APPEARANCE = 'encrypt-app-appearance';
const LS_SEED = 'encrypt-app-seed';
const LS_AMOLED = 'encrypt-app-amoled';

type VarMap = Record<string, string>;

const MD_ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'surface',
  'surfaceDim',
  'surfaceBright',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'surfaceVariant',
  'onSurface',
  'onSurfaceVariant',
  'outline',
  'outlineVariant',
  'inverseSurface',
  'inverseOnSurface',
  'inversePrimary',
  'surfaceTint',
  'shadow',
  'scrim',
] as const;

export type MdRole = (typeof MD_ROLES)[number];
export type MdScheme = Record<MdRole, string>;

const MD_COLOR_LOOKUP = MaterialDynamicColors as unknown as Record<MdRole, DynamicColor>;

// Text-bearing pairs that must stay readable for every seed: [foreground, background, minimum ratio].
// Backgrounds are the worst case of their family (highest container), so lower containers pass too.
export const CONTRAST_PAIRS: readonly [MdRole, MdRole, number][] = [
  ['onSurface', 'surfaceContainerHighest', 4.5],
  ['onSurfaceVariant', 'surfaceContainerHighest', 4.5],
  ['primary', 'surfaceContainerHighest', 4.5],
  ['secondary', 'surfaceContainer', 4.5],
  ['error', 'surfaceContainerHighest', 4.5],
  ['onPrimary', 'primary', 4.5],
  ['onPrimaryContainer', 'primaryContainer', 4.5],
  ['onSecondary', 'secondary', 4.5],
  ['onSecondaryContainer', 'secondaryContainer', 4.5],
  ['onTertiary', 'tertiary', 4.5],
  ['onTertiaryContainer', 'tertiaryContainer', 4.5],
  ['onError', 'error', 4.5],
  ['onErrorContainer', 'errorContainer', 4.5],
  ['inverseOnSurface', 'inverseSurface', 4.5],
  ['inversePrimary', 'inverseSurface', 4.5],
  ['outline', 'surface', 3],
];

export function contrastRatio(a: string, b: string): number {
  return Contrast.ratioOfTones(Hct.fromInt(argbFromHex(a)).tone, Hct.fromInt(argbFromHex(b)).tone);
}

function enforce(fg: string, bg: string, min: number): string {
  if (contrastRatio(fg, bg) >= min) return fg;
  const f = Hct.fromInt(argbFromHex(fg));
  const bgTone = Hct.fromInt(argbFromHex(bg)).tone;
  const lighter = Contrast.lighter(bgTone, min);
  const darker = Contrast.darker(bgTone, min);
  const tone = bgTone < 50 ? (lighter >= 0 ? lighter : 100) : darker >= 0 ? darker : 0;
  return hexFromArgb(Hct.from(f.hue, f.chroma, tone).toInt());
}

export function materialScheme(seedHex: string, dark: boolean): MdScheme {
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seedHex)), dark, 0, SPEC_VERSION, 'phone');
  const out = {} as MdScheme;
  for (const role of MD_ROLES) {
    out[role] = hexFromArgb(MD_COLOR_LOOKUP[role].getArgb(scheme));
  }
  for (const [fg, bg, min] of CONTRAST_PAIRS) out[fg] = enforce(out[fg], out[bg], min);
  return out;
}

const kebab = (role: string) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Map a computed MD3 role palette onto the M3 system tokens, the app's semantic tokens
// and the `--k-color-md-*` slots Konsta components consume.
function mapScheme(r: MdScheme, dark: boolean): VarMap {
  const p = dark ? '--k-color-md-dark' : '--k-color-md-light';
  const warn = dark ? WARN.dark : WARN.light;
  const sys: VarMap = {};
  for (const role of MD_ROLES) sys[`--md-sys-color-${kebab(role)}`] = r[role];
  return {
    ...sys,

    [`${p}-primary`]: r.primary,
    [`${p}-on-primary`]: r.onPrimary,
    [`${p}-primary-container`]: r.primaryContainer,
    [`${p}-on-primary-container`]: r.onPrimaryContainer,
    [`${p}-secondary`]: r.secondary,
    [`${p}-on-secondary`]: r.onSecondary,
    [`${p}-secondary-container`]: r.secondaryContainer,
    [`${p}-on-secondary-container`]: r.onSecondaryContainer,
    [`${p}-surface`]: r.surface,
    [`${p}-on-surface`]: r.onSurface,
    [`${p}-surface-variant`]: r.surfaceVariant,
    [`${p}-on-surface-variant`]: r.onSurfaceVariant,
    [`${p}-outline`]: r.outline,
    [`${p}-outline-variant`]: r.outlineVariant,
    [`${p}-surface-1`]: r.surfaceContainerLow,
    [`${p}-surface-2`]: r.surfaceContainer,
    [`${p}-surface-3`]: r.surfaceContainerHigh,
    [`${p}-surface-4`]: r.surfaceContainerHigh,
    [`${p}-surface-5`]: r.surfaceContainerHighest,

    '--app-bg': r.surface,
    '--app-surface': r.surfaceContainerLow,
    '--app-surface-2': r.surfaceContainer,
    '--app-surface-3': r.surfaceContainerHigh,
    '--app-fill': r.surfaceContainerHighest,
    '--app-fill-2': r.surfaceContainerHigh,
    '--app-separator': r.outlineVariant,
    '--app-outline': r.outline,
    '--app-label': r.onSurface,
    '--app-label-2': r.onSurfaceVariant,
    '--app-label-3': r.onSurfaceVariant,
    '--app-tint': r.primary,
    '--app-on-tint': r.onPrimary,
    '--app-tint-strong': r.primary,
    '--app-tint-container': r.primaryContainer,
    '--app-on-tint-container': r.onPrimaryContainer,
    '--app-tint-weak': r.secondaryContainer,
    '--app-on-tint-weak': r.onSecondaryContainer,
    '--app-error': r.error,
    '--app-on-error': r.onError,
    '--app-error-weak': r.errorContainer,
    '--app-on-error-weak': r.onErrorContainer,
    '--app-warn': warn.warn,
    '--app-warn-weak': warn.weak,
    '--app-on-warn-weak': warn.onWeak,
    '--app-bar': r.surfaceContainer,
    '--app-sheet': r.surfaceContainerLow,
    '--app-bubble': r.surfaceContainerHigh,
    '--app-on-bubble': r.onSurface,
    '--app-bubble-mine': r.primaryContainer,
    '--app-on-bubble-mine': r.onPrimaryContainer,
    '--app-scrim': `color-mix(in srgb, ${r.scrim} 32%, transparent)`,
    '--app-inverse-surface': r.inverseSurface,
    '--app-inverse-on-surface': r.inverseOnSurface,
    '--app-inverse-primary': r.inversePrimary,
    '--app-shadow': `0 1px 2px color-mix(in srgb, ${r.shadow} 30%, transparent), 0 2px 6px 2px color-mix(in srgb, ${r.shadow} 15%, transparent)`,
  };
}

export interface AppThemeState {
  platform: AppPlatform;
  appearance: AppAppearance;
  seed: string;
  amoled?: boolean;
}

function amoledVars(dark: VarMap): VarMap {
  const deepen = (key: string, keep: number) => `color-mix(in srgb, ${dark[key]} ${keep}%, ${AMOLED_BLACK})`;
  return {
    '--app-bg': AMOLED_BLACK,
    '--app-surface': deepen('--app-surface', 45),
    '--app-surface-2': deepen('--app-surface-2', 55),
    '--app-surface-3': deepen('--app-surface-3', 65),
    '--app-fill': deepen('--app-fill', 75),
    '--app-fill-2': deepen('--app-fill-2', 65),
    '--app-bar': AMOLED_BLACK,
    '--app-sheet': deepen('--app-sheet', 50),
    '--app-bubble': deepen('--app-bubble', 70),
    '--md-sys-color-surface': AMOLED_BLACK,
    '--md-sys-color-surface-container-lowest': AMOLED_BLACK,
    '--md-sys-color-surface-container-low': deepen('--md-sys-color-surface-container-low', 45),
    '--md-sys-color-surface-container': deepen('--md-sys-color-surface-container', 55),
    '--md-sys-color-surface-container-high': deepen('--md-sys-color-surface-container-high', 65),
    '--md-sys-color-surface-container-highest': deepen('--md-sys-color-surface-container-highest', 75),
    '--k-color-md-dark-surface': AMOLED_BLACK,
    '--k-color-md-dark-surface-1': deepen('--app-surface', 45),
    '--k-color-md-dark-surface-2': deepen('--app-surface-2', 55),
    '--k-color-md-dark-surface-3': deepen('--app-surface-3', 65),
    '--k-color-md-dark-surface-4': deepen('--app-surface-3', 65),
    '--k-color-md-dark-surface-5': deepen('--app-fill', 75),
  };
}

export function detectPlatform(): AppPlatform {
  if (typeof navigator === 'undefined') return 'ios';
  const hint = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  if (hint) return /^(ios|macos)$/i.test(hint) ? 'ios' : 'material';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'material';
  return /iPhone|iPad|iPod|Macintosh/.test(ua) ? 'ios' : 'material';
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function isSeed(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function loadThemeState(): AppThemeState {
  const platformRaw = readStored(LS_PLATFORM);
  const platform: AppPlatform =
    platformRaw === 'ios' || platformRaw === 'material' ? platformRaw : detectPlatform();
  const appearanceRaw = readStored(LS_APPEARANCE);
  const appearance: AppAppearance =
    appearanceRaw === 'light' || appearanceRaw === 'dark' || appearanceRaw === 'system'
      ? appearanceRaw
      : 'system';
  const seedRaw = readStored(LS_SEED);
  const seed = isSeed(seedRaw) ? seedRaw : DEFAULT_SEED;
  return { platform, appearance, seed, amoled: readStored(LS_AMOLED) === '1' };
}

export function saveThemeState(state: AppThemeState) {
  try {
    localStorage.setItem(LS_PLATFORM, state.platform);
    localStorage.setItem(LS_APPEARANCE, state.appearance);
    localStorage.setItem(LS_SEED, state.seed);
    localStorage.setItem(LS_AMOLED, state.amoled ? '1' : '0');
  } catch {}
}

export function resolveScheme(appearance: AppAppearance): AppScheme {
  if (appearance !== 'system') return appearance;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

// Compute both light and dark var sets for a seed and persist them so the
// pre-hydration bootstrap can re-apply a custom seed without the MCU bundle.
type CachedVars = { v: number; seed: string; light: VarMap; dark: VarMap; amoled: VarMap };

export function computeAndCache(seedHex: string): CachedVars {
  const light = mapScheme(materialScheme(seedHex, false), false);
  const dark = mapScheme(materialScheme(seedHex, true), true);
  const amoled = amoledVars(dark);
  const out = { v: CACHE_VERSION, seed: seedHex, light, dark, amoled };
  try {
    localStorage.setItem(LS_MD_VARS, JSON.stringify(out));
  } catch {}
  return out;
}

export function cachedVars(): CachedVars | null {
  try {
    const raw = localStorage.getItem(LS_MD_VARS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.v === CACHE_VERSION && typeof parsed.seed === 'string' && parsed.light && parsed.dark && parsed.amoled
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function applyVars(vars: VarMap, target?: HTMLElement) {
  const el = target ?? document.documentElement;
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

const INLINE_VAR_RE = /^--(app-|k-color-md-|md-sys-color-)/;

export function clearInlineVars() {
  const style = document.documentElement.style;
  const names: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i);
    if (INLINE_VAR_RE.test(name)) names.push(name);
  }
  for (const name of names) style.removeProperty(name);
}

export function applyTheme(state: AppThemeState): AppScheme {
  const scheme = resolveScheme(state.appearance);
  const root = document.documentElement;
  root.dataset.appPlatform = state.platform;
  root.dataset.appScheme = scheme;
  root.classList.toggle('dark', scheme === 'dark');
  root.classList.toggle('light', scheme === 'light');
  const amoled = Boolean(state.amoled) && scheme === 'dark';
  if (amoled) root.dataset.appAmoled = '';
  else delete root.dataset.appAmoled;

  if (state.platform === 'material') {
    let vars = cachedVars();
    if (!vars || vars.seed !== state.seed) vars = computeAndCache(state.seed);
    clearInlineVars();
    applyVars(vars.light);
    applyVars(vars.dark);
    applyVars(scheme === 'dark' ? vars.dark : vars.light);
    if (amoled) applyVars(vars.amoled);
  } else {
    clearInlineVars();
  }

  const meta = document.querySelector('meta[name="theme-color"]:not([media])')
    ?? document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(root).getPropertyValue('--app-bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
  const statusMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusMeta) statusMeta.setAttribute('content', scheme === 'dark' ? 'black-translucent' : 'default');
  return scheme;
}
