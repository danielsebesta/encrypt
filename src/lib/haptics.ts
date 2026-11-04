export type HapticKind = 'light' | 'medium' | 'success' | 'warning';

const PATTERNS: Record<HapticKind, number[]> = {
  light: [8],
  medium: [15],
  success: [10, 30, 15],
  warning: [30, 40, 30],
};

const STORAGE_KEY = 'encrypt-app-haptics';
let tick: HTMLLabelElement | null = null;

function enabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** iOS has no vibrate(); a click on a switch input gives the system haptic tick instead. */
function iosTick() {
  if (!tick) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.id = 'haptic-tick';
    input.tabIndex = -1;
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.setAttribute('aria-hidden', 'true');
    Object.assign(label.style, { position: 'fixed', left: '-100px', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', overflow: 'hidden' });
    label.appendChild(input);
    document.body.appendChild(label);
    tick = label;
  }
  tick.click();
}

export function haptic(kind: HapticKind = 'light') {
  if (typeof window === 'undefined' || !enabled()) return;
  const pattern = PATTERNS[kind];
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
      return;
    }
    const taps = pattern.filter((_, i) => i % 2 === 0).length;
    iosTick();
    for (let i = 1; i < taps; i++) setTimeout(iosTick, i * 70);
  } catch {}
}
