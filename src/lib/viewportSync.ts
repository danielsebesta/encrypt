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
  // Layout height with no keyboard up; re-baselined whenever the viewport is calm
  // so rotation and browser-chrome changes are picked up.
  let fullHeight = window.innerHeight;
  const settle = () => {
    // Scrolling the window while a field is focused dismisses the iOS keyboard and makes the
    // composer jump. Only pin the page when nothing is being typed.
    if (isTextField(document.activeElement)) return;
    if (vv.offsetTop > 0 || vv.offsetLeft > 0 || window.scrollY > 0 || window.scrollX > 0) window.scrollTo(0, 0);
  };
  const apply = () => {
    const focused = isTextField(document.activeElement);
    // The keyboard hides the bottom of the layout viewport: Safari shrinks the visual
    // viewport by that much, interactive-widget=resizes-content shrinks the layout
    // viewport itself. WebKit's reveal-pan (offsetTop) only moves the visible window,
    // it does not shrink it, so it must not be counted as keyboard coverage.
    const covered = Math.max(0, window.innerHeight - vv.height);
    const reported = covered > KEYBOARD_MIN_PX || window.innerHeight < fullHeight - KEYBOARD_MIN_PX;
    // Some iOS builds leave the visual viewport at full height while the keyboard overlays
    // the page; a focused field then still has to end up above it, so a keyboard-sized
    // share is assumed rather than letting it sit underneath.
    const unreported = focused && !reported && root.dataset.appPlatform === 'ios';
    if (!focused && covered <= KEYBOARD_MIN_PX) fullHeight = window.innerHeight;
    const height = unreported
      ? Math.round(fullHeight * (1 - FALLBACK_KEYBOARD_RATIO))
      : Math.max(200, Math.round(vv.height));
    // WebKit pans the visual viewport down to reveal the focused field; the app has to
    // follow that pan or it ends up above the visible window (an empty void on iOS).
    const offset = unreported ? 0 : Math.max(0, Math.round(vv.offsetTop));
    root.style.setProperty('--app-vvh', `${height}px`);
    root.style.setProperty('--app-vvo', `${offset}px`);
    root.classList.toggle('app-kbd', reported || unreported);
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
    root.style.removeProperty('--app-vvo');
    root.classList.remove('app-kbd');
  };
}
