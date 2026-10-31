const HOLD_MS = 500;
const SLOP_PX = 10;

/** Calls back after a touch is held still on the node, the way touch screens open a context menu. */
export function longPress(node: HTMLElement, callback: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | null = null;
  let fired = false;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    start = null;
  };

  function down(event: PointerEvent) {
    if (event.pointerType !== 'touch') return;
    if ((event.target as HTMLElement | null)?.closest('button, a, input, audio, video, [role="button"]')) return;
    fired = false;
    start = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      fired = true;
      cancel();
      callback();
    }, HOLD_MS);
  }

  function move(event: PointerEvent) {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) cancel();
  }

  function menu(event: Event) {
    if (fired) event.preventDefault();
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', menu);
  return {
    update(next: () => void) {
      callback = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('contextmenu', menu);
    },
  };
}
