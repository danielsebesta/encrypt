export const BG_MODES = ['estuary', 'capillary', 'shockwave'] as const;
export type BgMode = (typeof BG_MODES)[number];
export const BG_MODE_EVENT = 'bg-mode';
const KEY = 'encrypt.click:bg-mode';

export function readBgMode(): BgMode {
  try {
    const value = localStorage.getItem(KEY);
    if ((BG_MODES as readonly string[]).includes(value ?? '')) return value as BgMode;
  } catch {}
  return 'estuary';
}

export function writeBgMode(mode: BgMode): void {
  try { localStorage.setItem(KEY, mode); } catch {}
  window.dispatchEvent(new CustomEvent(BG_MODE_EVENT, { detail: mode }));
}
