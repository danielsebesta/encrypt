const KEYBOARD_MIN_PX = 120;

/** Tracks the visual viewport so the app can fit above the on-screen keyboard and its accessory bar. */
export function installViewportSync(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  const settle = () => {
    if (vv.offsetTop > 0 || vv.offsetLeft > 0 || window.scrollY > 0 || window.scrollX > 0) window.scrollTo(0, 0);
  };
  const apply = () => {
    root.style.setProperty('--app-vvh', `${Math.round(vv.height)}px`);
    root.classList.toggle('app-kbd', window.innerHeight - vv.height > KEYBOARD_MIN_PX);
    settle();
  };
  const onFocusOut = () => {
    setTimeout(apply, 50);
    setTimeout(apply, 350);
  };
  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  window.addEventListener('scroll', settle, { passive: true });
  document.addEventListener('focusout', onFocusOut);
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
    window.removeEventListener('scroll', settle);
    document.removeEventListener('focusout', onFocusOut);
    root.style.removeProperty('--app-vvh');
    root.classList.remove('app-kbd');
  };
}
