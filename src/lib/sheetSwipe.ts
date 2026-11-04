const GRAB_PX = 64;
const CLOSE_PX = 96;
const CLOSE_VELOCITY = 0.6;
const SLOP_PX = 8;

/** Lets touch users pull a Konsta sheet down by its handle or top edge, which closes it like a tap on the backdrop. */
export function installSheetSwipe(): () => void {
  let sheet: HTMLElement | null = null;
  let backdrop: HTMLElement | null = null;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let id = -1;
  let dragging = false;

  function down(event: PointerEvent) {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    const target = event.target as HTMLElement | null;
    const found = target?.closest<HTMLElement>('.k-sheet');
    if (!found || target?.closest('button, a, input, textarea, select, [role="button"]')) return;
    const top = found.getBoundingClientRect().top;
    if (event.clientY - top > GRAB_PX && !target?.closest('.app-sheet__handle')) return;
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
      dragging = true;
      sheet.style.transition = 'none';
      try { sheet.setPointerCapture(id); } catch {}
    }
    const dt = Math.max(1, event.timeStamp - lastT);
    velocity = (event.clientY - lastY) / dt;
    lastY = event.clientY;
    lastT = event.timeStamp;
    sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }

  function up(event: PointerEvent) {
    if (!sheet || event.pointerId !== id) return;
    const el = sheet;
    const close = dragging && event.type === 'pointerup' && (event.clientY - startY > CLOSE_PX || velocity > CLOSE_VELOCITY);
    const bd = backdrop;
    sheet = null;
    backdrop = null;
    if (!dragging) return;
    dragging = false;
    if (close && bd) {
      bd.click();
      requestAnimationFrame(() => { el.style.transition = ''; el.style.transform = ''; });
      return;
    }
    el.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
    el.style.transform = '';
    setTimeout(() => { el.style.transition = ''; }, 240);
  }

  document.addEventListener('pointerdown', down, { passive: true });
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerup', up, { passive: true });
  document.addEventListener('pointercancel', up, { passive: true });
  return () => {
    document.removeEventListener('pointerdown', down);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
  };
}
