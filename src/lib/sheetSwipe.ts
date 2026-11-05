/** Top strip where a downward drag always starts a dismiss (handle + title area). */
export const GRAB_PX = 140;
/** How far the sheet must travel before release counts as a close. */
export const CLOSE_PX = 44;
/** Flick speed (px/ms) that closes even on a short drag. */
export const CLOSE_VELOCITY = 0.28;
const SLOP_PX = 6;

function scrollChild(sheet: HTMLElement): HTMLElement | null {
  const child = sheet.querySelector<HTMLElement>(':scope > *:not(.app-sheet__handle)');
  return child;
}

function allowStart(target: HTMLElement, sheet: HTMLElement, clientY: number): boolean {
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return false;
  if (target.closest('.app-sheet__handle')) return true;
  const top = sheet.getBoundingClientRect().top;
  if (clientY - top <= GRAB_PX) return true;
  const scroller = scrollChild(sheet);
  return Boolean(scroller && scroller.scrollTop <= 0);
}

/** Lets touch users pull a Konsta sheet down by its handle, top edge, or body (when scrolled to top). */
export function installSheetSwipe(): () => void {
  let sheet: HTMLElement | null = null;
  let backdrop: HTMLElement | null = null;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let id = -1;
  let dragging = false;
  let fromBody = false;

  function down(event: PointerEvent) {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const found = target.closest<HTMLElement>('.k-sheet');
    if (!found || !allowStart(target, found, event.clientY)) return;
    const top = found.getBoundingClientRect().top;
    fromBody = event.clientY - top > GRAB_PX && !target.closest('.app-sheet__handle');
    const prev = found.previousElementSibling;
    sheet = found;
    backdrop = prev instanceof HTMLElement && !prev.classList.contains('k-sheet') ? prev : null;
    startY = lastY = event.clientY;
    lastT = event.timeStamp;
    velocity = 0;
    id = event.pointerId;
    dragging = false;
  }

  function move(event: PointerEvent) {
    if (!sheet || event.pointerId !== id) return;
    const dy = event.clientY - startY;
    if (!dragging) {
      if (dy < SLOP_PX) return;
      if (fromBody) {
        const scroller = scrollChild(sheet);
        if (scroller && scroller.scrollTop > 0) {
          sheet = null;
          backdrop = null;
          return;
        }
      }
      dragging = true;
      sheet.style.transition = 'none';
      try { sheet.setPointerCapture(id); } catch {}
    }
    if (event.cancelable) event.preventDefault();
    const dt = Math.max(1, event.timeStamp - lastT);
    velocity = (event.clientY - lastY) / dt;
    lastY = event.clientY;
    lastT = event.timeStamp;
    // Konsta/Tailwind v4 open the sheet with `translate` (not `transform`).
    sheet.style.translate = `0 calc(-100% + ${Math.max(0, dy)}px)`;
  }

  function up(event: PointerEvent) {
    if (!sheet || event.pointerId !== id) return;
    const el = sheet;
    const close = dragging && event.type === 'pointerup' && (event.clientY - startY > CLOSE_PX || velocity > CLOSE_VELOCITY);
    const bd = backdrop;
    sheet = null;
    backdrop = null;
    fromBody = false;
    if (!dragging) return;
    dragging = false;
    if (close && bd) {
      bd.click();
      requestAnimationFrame(() => { el.style.transition = ''; el.style.translate = ''; });
      return;
    }
    el.style.transition = 'translate 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
    el.style.translate = '';
    setTimeout(() => { el.style.transition = ''; }, 240);
  }

  document.addEventListener('pointerdown', down, { passive: true });
  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', up, { passive: true });
  document.addEventListener('pointercancel', up, { passive: true });
  return () => {
    document.removeEventListener('pointerdown', down);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
  };
}
