export type HapticKind = 'light' | 'medium' | 'success' | 'warning';

/** One pulse; delay is silence before it. Intensity is 0–1 (PWM on Android, tick rate on iOS). */
type Vibration = { duration: number; delay?: number; intensity?: number };

/**
 * UIKit-shaped presets (same idea as web-haptics): notification / impact styles
 * rather than flat millisecond arrays.
 */
const PATTERNS: Record<HapticKind, Vibration[]> = {
  light: [{ duration: 15, intensity: 0.4 }],
  medium: [{ duration: 25, intensity: 0.7 }],
  success: [
    { duration: 30, intensity: 0.5 },
    { delay: 60, duration: 40, intensity: 1 },
  ],
  warning: [
    { duration: 40, intensity: 0.8 },
    { delay: 100, duration: 40, intensity: 0.6 },
  ],
};

const STORAGE_KEY = 'encrypt-app-haptics';
const PWM_CYCLE = 20;
const MAX_PHASE_MS = 1000;
const TOGGLE_MIN = 16;
const TOGGLE_MAX = 184;

let tickLabel: HTMLLabelElement | null = null;
let rafId: number | null = null;

function enabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function isIosTouch(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

function isTouchPrimary(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Whether this browser can produce a real haptic / vibration feedback.
 * Desktop Chrome exposes `navigator.vibrate` but has no motor — only offer
 * the setting on touch-first devices (and iOS, which uses a switch-input tick).
 */
export function hapticsAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isIosTouch()) return true;
  if (typeof navigator.vibrate !== 'function') return false;
  return isTouchPrimary() || /Android|Mobile/i.test(navigator.userAgent);
}

/** PWM: Vibration API is on/off only, so intensity becomes rapid duty-cycle. */
export function modulateVibration(duration: number, intensity: number): number[] {
  const ms = Math.min(MAX_PHASE_MS, Math.max(0, duration));
  const level = Math.max(0, Math.min(1, intensity));
  if (ms <= 0 || level <= 0) return [];
  if (level >= 1) return [ms];

  const onTime = Math.max(1, Math.round(PWM_CYCLE * level));
  const offTime = PWM_CYCLE - onTime;
  const result: number[] = [];
  let remaining = ms;
  while (remaining >= PWM_CYCLE) {
    result.push(onTime, offTime);
    remaining -= PWM_CYCLE;
  }
  if (remaining > 0) {
    const remOn = Math.max(1, Math.round(remaining * level));
    result.push(remOn);
    const remOff = remaining - remOn;
    if (remOff > 0) result.push(remOff);
  }
  return result;
}

/** Flatten phases into `navigator.vibrate`'s alternating on/off array. */
export function toVibratePattern(vibrations: Vibration[], defaultIntensity = 0.5): number[] {
  const result: number[] = [];
  for (const vib of vibrations) {
    const intensity = Math.max(0, Math.min(1, vib.intensity ?? defaultIntensity));
    const delay = vib.delay ?? 0;
    if (delay > 0) {
      if (result.length > 0 && result.length % 2 === 0) result[result.length - 1]! += delay;
      else {
        if (result.length === 0) result.push(0);
        result.push(delay);
      }
    }
    const modulated = modulateVibration(vib.duration, intensity);
    if (modulated.length === 0) {
      if (result.length > 0 && result.length % 2 === 0) result[result.length - 1]! += vib.duration;
      else if (vib.duration > 0) result.push(0, vib.duration);
      continue;
    }
    for (const seg of modulated) result.push(seg);
  }
  return result;
}

/** iOS has no vibrate(); clicking a native switch control fires a system haptic tick. */
function ensureTick(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null;
  if (tickLabel) return tickLabel;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = 'encrypt-haptic-tick';
  input.tabIndex = -1;
  // Safari needs a real control appearance for the switch haptic to fire.
  input.style.all = 'initial';
  input.style.appearance = 'auto';
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.setAttribute('aria-hidden', 'true');
  Object.assign(label.style, {
    position: 'fixed',
    left: '-100px',
    top: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
    overflow: 'hidden',
  });
  label.appendChild(input);
  document.body.appendChild(label);
  tickLabel = label;
  return label;
}

function stopIosPattern() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function fireTick() {
  ensureTick()?.click();
}

/**
 * Replay phases on iOS by clicking the switch: first click stays inside the
 * user-gesture window; later taps follow an rAF timeline with intensity-based
 * spacing (same approach as web-haptics).
 */
function runIosPattern(vibrations: Vibration[]) {
  stopIosPattern();
  const label = ensureTick();
  if (!label) return;

  const phases: { end: number; isOn: boolean; intensity: number }[] = [];
  let cumulative = 0;
  for (const vib of vibrations) {
    const intensity = Math.max(0, Math.min(1, vib.intensity ?? 0.5));
    const delay = vib.delay ?? 0;
    if (delay > 0) {
      cumulative += delay;
      phases.push({ end: cumulative, isOn: false, intensity: 0 });
    }
    cumulative += Math.min(MAX_PHASE_MS, Math.max(0, vib.duration));
    phases.push({ end: cumulative, isOn: true, intensity });
  }
  if (!phases.length || cumulative <= 0) {
    fireTick();
    return;
  }

  // Sync first click when the pattern starts "on" — keeps user activation.
  const startsOn = (vibrations[0]?.delay ?? 0) === 0;
  let firstClickFired = false;
  if (startsOn) {
    fireTick();
    firstClickFired = true;
  }

  let startTime = 0;
  let lastToggleTime = -1;

  const loop = (time: number) => {
    if (startTime === 0) startTime = time;
    const elapsed = time - startTime;
    if (elapsed >= cumulative) {
      rafId = null;
      return;
    }
    let phase = phases[0]!;
    for (const p of phases) {
      if (elapsed < p.end) {
        phase = p;
        break;
      }
    }
    if (phase.isOn) {
      const toggleInterval = TOGGLE_MIN + (1 - phase.intensity) * TOGGLE_MAX;
      if (lastToggleTime === -1) {
        lastToggleTime = time;
        if (!firstClickFired) {
          fireTick();
          firstClickFired = true;
        }
      } else if (time - lastToggleTime >= toggleInterval) {
        fireTick();
        lastToggleTime = time;
      }
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

export function haptic(kind: HapticKind = 'light') {
  if (typeof window === 'undefined' || !enabled() || !hapticsAvailable()) return;
  const vibrations = PATTERNS[kind];
  try {
    if (typeof navigator.vibrate === 'function' && !isIosTouch()) {
      const pattern = toVibratePattern(vibrations);
      if (pattern.length) navigator.vibrate(pattern);
      return;
    }
    runIosPattern(vibrations);
  } catch {}
}
