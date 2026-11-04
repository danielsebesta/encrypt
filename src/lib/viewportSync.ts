const KEYBOARD_MIN_PX = 120;

/** Tracks the visual viewport so the app can fit above the on-screen keyboard and its accessory bar. */
export function installViewportSync(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  const apply = () => {
    root.style.setProperty('--app-vvh', `${Math.round(vv.height)}px`);
    const open = window.innerHeight - vv.height > KEYBOARD_MIN_PX;
    root.classList.toggle('app-kbd', open);
    if (open && (vv.offsetTop > 0 || window.scrollY > 0)) window.scrollTo(0, 0);
  };
  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
    root.style.removeProperty('--app-vvh');
    root.classList.remove('app-kbd');
  };
}
