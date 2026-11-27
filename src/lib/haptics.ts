export type HapticKind = 'light' | 'medium' | 'success' | 'warning';

type Vibration = { duration: number; delay?: number; intensity?: number };

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

import { loadHapticsMode } from './appPrefs';

const PWM_CYCLE = 20;
const MAX_PHASE_MS = 1000;
/**
 * iOS 18.4+ / 26 ("granted" mode in ios-vibrator-pro-max): programmatic switch
 * clicks only work for ~850ms after a trusted click/touchend — not forever.
 */
const GRANT_MS = 850;
const TICK_MS = 26;
const TOGGLE_MIN = 16;
const TOGGLE_MAX = 184;

let tickLabel: HTMLLabelElement | null = null;
let rafId: number | null = null;
let grantUntil = 0;
let grantInstalled = false;

function allows(kind: HapticKind): boolean {
  const mode = loadHapticsMode();
  if (mode === 'off') return false;
  if (mode === 'essential') return kind !== 'light';
  return true;
}

export function hapticAllowed(kind: HapticKind): boolean {
  return allows(kind);
}

export function isIosTouch(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

let nativeTickAt = 0;
const NATIVE_TICK_DEDUP_MS = 60;

export function noteNativeHapticTick() {
  nativeTickAt = Date.now();
}

/** iOS 18.4+/26 only grants switch ticks after a real click/touchend — not mid long-press. */
export function hapticsNeedGestureEnd(): boolean {
  return isIosTouch();
}

function isTouchPrimary(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function hapticsAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isIosTouch()) return true;
  if (typeof navigator.vibrate !== 'function') return false;
  return isTouchPrimary() || /Android|Mobile/i.test(navigator.userAgent);
}

function refreshGrant() {
  grantUntil = Date.now() + GRANT_MS;
}

function grantAlive() {
  if (typeof navigator !== 'undefined' && navigator.userActivation?.isActive) {
    refreshGrant();
    return true;
  }
  return Date.now() < grantUntil;
}

export function installHapticGrant() {
  if (grantInstalled || typeof window === 'undefined') return;
  grantInstalled = true;
  const onGesture = (e: Event) => {
    if (!(e as UIEvent).isTrusted) return;
    refreshGrant();
  };
  window.addEventListener('click', onGesture, true);
  window.addEventListener('touchend', onGesture, true);
  window.addEventListener('pointerup', onGesture, true);
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keyup', onGesture, true);
}

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

function ensureTick(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null;
  if (tickLabel) return tickLabel;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.setAttribute('style', 'display: none !important');
  input.tabIndex = -1;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.tabIndex = -1;
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

function runIosPattern(vibrations: Vibration[]) {
  stopIosPattern();
  installHapticGrant();
  const label = ensureTick();
  if (!label) return;

  if (navigator.userActivation?.isActive) refreshGrant();

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
    if (elapsed >= cumulative || !grantAlive()) {
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
      const toggleInterval = Math.max(
        TICK_MS,
        TOGGLE_MIN + (1 - phase.intensity) * (TOGGLE_MAX * 0.35),
      );
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
  if (typeof window === 'undefined' || !allows(kind) || !hapticsAvailable()) return;
  if (Date.now() - nativeTickAt < NATIVE_TICK_DEDUP_MS) return;
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
