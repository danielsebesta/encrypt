type Options = { onDismiss?: () => void; max?: number };

const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 10;
const DISMISS_PX = 110;

/** Pinch, double-tap, wheel and drag zoom for the first child of `node`; a tap beside it or a pull down at 1x calls `onDismiss`. */
export function zoomPan(node: HTMLElement, options: Options = {}) {
  let opts = options;
  const target = () => node.firstElementChild as HTMLElement | null;
  const pointers = new Map<number, { x: number; y: number }>();
  let scale = 1;
  let x = 0;
  let y = 0;
  let startDistance = 0;
  let startScale = 1;
  let travel = 0;
  let pullY = 0;
  let lastTap = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let downOnStage = false;

  const max = () => opts.max ?? 6;

  function clamp() {
    const el = target();
    if (!el) return;
    scale = Math.min(max(), Math.max(1, scale));
    const limitX = Math.max(0, (el.offsetWidth * scale - node.clientWidth) / 2);
    const limitY = Math.max(0, (el.offsetHeight * scale - node.clientHeight) / 2);
    x = scale === 1 ? 0 : Math.min(limitX, Math.max(-limitX, x));
    y = scale === 1 ? Math.min(Math.max(pullY, 0), 400) : Math.min(limitY, Math.max(-limitY, y));
  }

  function paint(animate: boolean) {
    const el = target();
    if (!el) return;
    el.style.transition = animate ? 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  function distance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function down(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    node.setPointerCapture?.(event.pointerId);
    if (pointers.size === 1) {
      travel = 0;
      pullY = 0;
      downOnStage = event.target === node;
    }
    if (pointers.size === 2) {
      startDistance = distance();
      startScale = scale;
    }
  }

  function move(event: PointerEvent) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    travel += Math.abs(dx) + Math.abs(dy);
    if (pointers.size >= 2 && startDistance > 0) {
      scale = startScale * (distance() / startDistance);
      clamp();
    } else if (scale > 1) {
      x += dx;
      y += dy;
      clamp();
    } else {
      pullY += dy;
      clamp();
    }
    paint(false);
  }

  function up(event: PointerEvent) {
    if (!pointers.delete(event.pointerId)) return;
    node.releasePointerCapture?.(event.pointerId);
    if (pointers.size > 0) {
      startDistance = pointers.size === 2 ? distance() : 0;
      startScale = scale;
      return;
    }
    const tapped = travel < TAP_SLOP_PX;
    if (scale === 1 && pullY > DISMISS_PX) {
      opts.onDismiss?.();
      return;
    }
    if (tapped && event.type === 'pointerup') {
      const now = event.timeStamp;
      if (now - lastTap < DOUBLE_TAP_MS && Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY) < 30) {
        scale = scale > 1 ? 1 : Math.min(max(), 2.5);
        x = 0;
        y = 0;
        lastTap = 0;
      } else {
        lastTap = now;
        lastTapX = event.clientX;
        lastTapY = event.clientY;
        if (downOnStage && scale === 1) {
          opts.onDismiss?.();
          return;
        }
      }
    }
    pullY = 0;
    clamp();
    paint(true);
  }

  function wheel(event: WheelEvent) {
    event.preventDefault();
    scale *= event.deltaY < 0 ? 1.15 : 1 / 1.15;
    clamp();
    paint(false);
  }

  node.style.touchAction = 'none';
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('wheel', wheel, { passive: false });

  return {
    update(next: Options) { opts = next; },
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('wheel', wheel);
    },
  };
}
