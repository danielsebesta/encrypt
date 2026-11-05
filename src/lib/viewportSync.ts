const KEYBOARD_MIN_PX = 120;
const FALLBACK_KEYBOARD_RATIO = 0.4;

function isTextField(node: EventTarget | null): boolean {
  return node instanceof HTMLElement && (node.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=file]), textarea') || node.isContentEditable);
}

/** Tracks the visual viewport so the app can fit above the on-screen keyboard and its accessory bar. */
export function installViewportSync(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const settle = () => {
    // Scrolling the window while a field is focused dismisses the iOS keyboard and makes the
    // composer jump. Only pin the page when nothing is being typed.
    if (isTextField(document.activeElement)) return;
    if (vv.offsetTop > 0 || vv.offsetLeft > 0 || window.scrollY > 0 || window.scrollX > 0) window.scrollTo(0, 0);
  };
  const apply = () => {
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const focused = isTextField(document.activeElement);
    // Some iOS builds leave the visual viewport at full height while the keyboard overlays the page; a focused field
    // then still has to end up above it, so a keyboard-sized share is assumed rather than letting it sit underneath.
    const unreported = focused && covered <= KEYBOARD_MIN_PX && root.dataset.appPlatform === 'ios';
    const height = unreported
      ? Math.round(window.innerHeight * (1 - FALLBACK_KEYBOARD_RATIO))
      : Math.max(200, Math.round(vv.height));
    root.style.setProperty('--app-vvh', `${height}px`);
    root.classList.toggle('app-kbd', covered > KEYBOARD_MIN_PX || unreported);
    settle();
  };
  const later = (ms: number) => {
    const timer = setTimeout(() => { timers.delete(timer); apply(); }, ms);
    timers.add(timer);
  };
  const onFocusIn = (event: FocusEvent) => {
    if (!isTextField(event.target)) return;
    later(50);
    later(350);
    later(700);
  };
  const onFocusOut = () => {
    later(50);
    later(350);
  };
  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  window.addEventListener('scroll', settle, { passive: true });
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  return () => {
    for (const timer of timers) clearTimeout(timer);
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
    window.removeEventListener('scroll', settle);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    root.style.removeProperty('--app-vvh');
    root.classList.remove('app-kbd');
  };
}
