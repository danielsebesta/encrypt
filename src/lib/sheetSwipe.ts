/** How far the sheet must travel before release counts as a close. */
export const CLOSE_PX = 44;
/** Flick speed (px/ms) that closes even on a short drag. */
export const CLOSE_VELOCITY = 0.28;
const SLOP_PX = 6;

function scrollChild(sheet: HTMLElement): HTMLElement | null {
  return sheet.querySelector<HTMLElement>(':scope > *:not(.app-sheet__handle)');
}

function allowStart(target: HTMLElement): boolean {
  // Don't steal text-field caret / selection gestures.
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return false;
  // Only modal sheets — not action sheets (long-press menus). Swiping those
  // races the opening pointer and dismisses as soon as the finger lifts.
  return Boolean(target.closest('.k-sheet'));
}

function applyDrag(el: HTMLElement, dy: number) {
  // Open sheet sits at translate(0, -100%); pull down toward closed.
  el.style.translate = `0 calc(-100% + ${Math.max(0, dy)}px)`;
}

function clearDrag(el: HTMLElement) {
  el.style.transition = '';
  el.style.translate = '';
}

/** Lets touch users pull a Konsta sheet down from anywhere (not only the handle). */
export function installSheetSwipe(): () => void {
  let panel: HTMLElement | null = null;
  let backdrop: HTMLElement | null = null;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let id = -1;
  let dragging = false;
  let needsTopScroll = false;

  function down(event: PointerEvent) {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    const target = event.target as HTMLElement | null;
    if (!target || !allowStart(target)) return;
    const found = target.closest<HTMLElement>('.k-sheet');
    if (!found) return;

    // Body drags only dismiss when the sheet's scrollable pane is at the top;
    // the handle can always start a dismiss even if content is scrolled.
    const onHandle = Boolean(target.closest('.app-sheet__handle'));
    needsTopScroll = !onHandle;
    if (needsTopScroll) {
      const scroller = scrollChild(found);
      if (scroller && scroller.scrollTop > 0) return;
    }

    const prev = found.previousElementSibling;
    panel = found;
    backdrop = prev instanceof HTMLElement && !prev.classList.contains('k-sheet') ? prev : null;
    startY = lastY = event.clientY;
    lastT = event.timeStamp;
    velocity = 0;
    id = event.pointerId;
    dragging = false;
  }

  function move(event: PointerEvent) {
    if (!panel || event.pointerId !== id) return;
    const dy = event.clientY - startY;
    if (!dragging) {
      if (dy < SLOP_PX) return;
      if (needsTopScroll) {
        const scroller = scrollChild(panel);
        if (scroller && scroller.scrollTop > 0) {
          panel = null;
          backdrop = null;
          return;
        }
      }
      dragging = true;
      panel.style.transition = 'none';
      try { panel.setPointerCapture(id); } catch {}
    }
    if (event.cancelable) event.preventDefault();
    const dt = Math.max(1, event.timeStamp - lastT);
    velocity = (event.clientY - lastY) / dt;
    lastY = event.clientY;
    lastT = event.timeStamp;
    applyDrag(panel, dy);
  }

  function up(event: PointerEvent) {
    if (!panel || event.pointerId !== id) return;
    const el = panel;
    const close = dragging && event.type === 'pointerup' && (event.clientY - startY > CLOSE_PX || velocity > CLOSE_VELOCITY);
    const bd = backdrop;
    panel = null;
    backdrop = null;
    needsTopScroll = false;
    if (!dragging) return;
    dragging = false;
    if (close && bd) {
      bd.click();
      requestAnimationFrame(() => clearDrag(el));
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
