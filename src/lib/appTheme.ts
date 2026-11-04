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
const STALE_KEYS = ['encrypt-app-platform', 'encrypt-app-appearance', 'encrypt-app-seed'];

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
    '--app-shadow': dark
      ? '0 8px 24px rgba(0,0,0,0.45)'
      : '0 8px 24px rgba(0,0,0,0.16)',
  };
}

export interface AppThemeState {
  platform: AppPlatform;
  appearance: AppAppearance;
  seed: string;
}

export function detectPlatform(): AppPlatform {
  if (typeof navigator === 'undefined') return 'ios';
  const hint = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  if (hint) return /^(ios|macos)$/i.test(hint) ? 'ios' : 'material';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'material';
  return /iPhone|iPad|iPod|Macintosh/.test(ua) ? 'ios' : 'material';
}

export function loadThemeState(): AppThemeState {
  try {
    for (const key of STALE_KEYS) localStorage.removeItem(key);
  } catch {}
  return { platform: detectPlatform(), appearance: 'system', seed: DEFAULT_SEED };
}

export function resolveScheme(appearance: AppAppearance): AppScheme {
  if (appearance !== 'system') return appearance;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

// Compute both light and dark var sets for a seed and persist them so the
// pre-hydration bootstrap can re-apply a custom seed without the MCU bundle.
export function computeAndCache(seedHex: string): { seed: string; light: VarMap; dark: VarMap } {
  const light = mapScheme(roles(seedHex, false), false);
  const dark = mapScheme(roles(seedHex, true), true);
  try {
    localStorage.setItem(LS_MD_VARS, JSON.stringify({ seed: seedHex, light, dark }));
  } catch {}
  return { seed: seedHex, light, dark };
}

export function cachedVars(): { seed: string; light: VarMap; dark: VarMap } | null {
  try {
    const raw = localStorage.getItem(LS_MD_VARS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.seed === 'string' && parsed.light && parsed.dark ? parsed : null;
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

  if (state.platform === 'material') {
    let vars = cachedVars();
    if (!vars || vars.seed !== state.seed) vars = computeAndCache(state.seed);
    applyVars(vars.light);
    applyVars(vars.dark);
    applyVars(scheme === 'dark' ? vars.dark : vars.light);
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
