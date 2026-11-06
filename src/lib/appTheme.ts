import {
  argbFromHex,
  hexFromArgb,
  Hct,
  SchemeTonalSpot,
  MaterialDynamicColors,
  DynamicColor,
} from '@material/material-color-utilities';

export type AppPlatform = 'ios' | 'material';
export type AppScheme = 'light' | 'dark';
export type AppAppearance = 'system' | AppScheme;

export const DEFAULT_SEED = '#86b94a';

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
  'scrim',
] as const;

type MdRole = (typeof MD_ROLES)[number];

const MD_COLOR_LOOKUP = MaterialDynamicColors as unknown as Record<MdRole, DynamicColor>;

function roles(seedHex: string, dark: boolean): Record<MdRole, string> {
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seedHex)), dark, 0);
  const out = {} as Record<MdRole, string>;
  for (const role of MD_ROLES) {
    out[role] = hexFromArgb(MD_COLOR_LOOKUP[role].getArgb(scheme));
  }
  return out;
}

// Map a computed MD3 role palette onto the app's semantic tokens
// plus the `--k-color-md-*` slots Konsta components consume.
function mapScheme(r: Record<MdRole, string>, dark: boolean): VarMap {
  const p = dark ? '--k-color-md-dark' : '--k-color-md-light';
  return {
    // Konsta material tokens
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

    // App semantic tokens
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
    '--app-tint-strong': dark ? r.primary : r.inversePrimary,
    '--app-tint-container': r.primaryContainer,
    '--app-on-tint-container': r.onPrimaryContainer,
    '--app-tint-weak': r.secondaryContainer,
    '--app-on-tint-weak': r.onSecondaryContainer,
    '--app-error': r.error,
    '--app-on-error': r.onError,
    '--app-error-weak': r.errorContainer,
    '--app-on-error-weak': r.onErrorContainer,
    '--app-warn': dark ? '#f2bf45' : '#8a5a00',
    '--app-warn-weak': dark ? '#443400' : '#f7e3ab',
    '--app-on-warn-weak': dark ? '#f7e3ab' : '#554000',
    '--app-bar': r.surfaceContainer,
    '--app-sheet': r.surfaceContainerLow,
    '--app-bubble': r.surfaceContainerHigh,
    '--app-on-bubble': r.onSurface,
    '--app-bubble-mine': r.primaryContainer,
    '--app-on-bubble-mine': r.onPrimaryContainer,
    '--app-scrim': `color-mix(in srgb, ${r.scrim} 40%, transparent)`,
    '--app-inverse-surface': r.inverseSurface,
    '--app-inverse-on-surface': r.inverseOnSurface,
    '--app-inverse-primary': r.inversePrimary,
    '--app-shadow': dark
      ? '0 8px 24px rgba(0,0,0,0.45)'
      : '0 8px 24px rgba(0,0,0,0.16)',
  };
}

export interface AppThemeState {
  platform: AppPlatform;
  appearance: AppAppearance;
  seed: string;
  amoled?: boolean;
}

function amoledVars(dark: VarMap): VarMap {
  const deepen = (key: string, keep: number) => `color-mix(in srgb, ${dark[key]} ${keep}%, #000)`;
  return {
    '--app-bg': '#000000',
    '--app-surface': deepen('--app-surface', 45),
    '--app-surface-2': deepen('--app-surface-2', 55),
    '--app-surface-3': deepen('--app-surface-3', 65),
    '--app-fill': deepen('--app-fill', 75),
    '--app-fill-2': deepen('--app-fill-2', 65),
    '--app-bar': '#000000',
    '--app-sheet': deepen('--app-sheet', 50),
    '--app-bubble': deepen('--app-bubble', 70),
    '--k-color-md-dark-surface': '#000000',
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
  const seed = seedRaw && /^#[0-9a-fA-F]{6}$/.test(seedRaw) ? seedRaw : DEFAULT_SEED;
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
type CachedVars = { seed: string; light: VarMap; dark: VarMap; amoled: VarMap };

export function computeAndCache(seedHex: string): CachedVars {
  const light = mapScheme(roles(seedHex, false), false);
  const dark = mapScheme(roles(seedHex, true), true);
  const amoled = amoledVars(dark);
  try {
    localStorage.setItem(LS_MD_VARS, JSON.stringify({ seed: seedHex, light, dark, amoled }));
  } catch {}
  return { seed: seedHex, light, dark, amoled };
}

export function cachedVars(): CachedVars | null {
  try {
    const raw = localStorage.getItem(LS_MD_VARS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.seed === 'string' && parsed.light && parsed.dark && parsed.amoled ? parsed : null;
  } catch {
    return null;
  }
}

export function applyVars(vars: VarMap, target?: HTMLElement) {
  const el = target ?? document.documentElement;
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

const INLINE_VAR_RE = /^--(app-|k-color-md-)/;

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
