import { LUCIDE } from './lucideIcons';
import { haptic } from './haptics';

const SLOP_PX = 10;
const MAX_PX = 84;
const ARM_PX = 56;
const EDGE_PX = 24;

type Options = { onreply: () => void; enabled?: boolean };

/** Drag a message to the right to reply, the way iOS and Android messengers do. Touch and pen only. */
export function swipeReply(node: HTMLElement, options: Options) {
  let opts = options;
  let start: { x: number; y: number; id: number } | null = null;
  let intent: '' | 'swipe' | 'scroll' = '';
  let armed = false;
  let icon: HTMLElement | null = null;

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ensureIcon() {
    if (icon) return icon;
    icon = document.createElement('span');
    icon.className = 'chat-swipe-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${LUCIDE['reply']}</svg>`;
    node.appendChild(icon);
    return icon;
  }

  function render(dx: number) {
    node.style.transform = dx ? `translateX(${dx}px)` : '';
    const progress = Math.min(1, dx / ARM_PX);
    const el = ensureIcon();
    el.style.opacity = String(progress);
    el.style.scale = String(0.6 + 0.4 * progress);
    el.classList.toggle('chat-swipe-icon--armed', dx >= ARM_PX);
  }

  function reset(animate: boolean) {
    node.classList.toggle('chat-swipe--settle', animate && !reduced());
    render(0);
    if (!animate || reduced()) node.classList.remove('chat-swipe--settle');
    armed = false;
  }

  function down(event: PointerEvent) {
    if (opts.enabled === false || !event.isPrimary || event.pointerType === 'mouse') return;
    if (event.clientX < EDGE_PX) return;
    if ((event.target as HTMLElement | null)?.closest('button, a, input, textarea, audio, video, [role="button"]')) return;
    node.classList.remove('chat-swipe--settle');
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    intent = '';
  }

  function move(event: PointerEvent) {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!intent) {
      if (Math.abs(dy) > SLOP_PX && Math.abs(dy) > Math.abs(dx)) intent = 'scroll';
      else if (dx > SLOP_PX && dx > Math.abs(dy)) {
        intent = 'swipe';
        try {
          node.setPointerCapture(event.pointerId);
        } catch {}
      } else if (dx < -SLOP_PX) intent = 'scroll';
      else return;
    }
    if (intent !== 'swipe') return;
    const eased = dx <= ARM_PX ? dx : ARM_PX + (dx - ARM_PX) * 0.25;
    const shown = Math.max(0, Math.min(MAX_PX, eased));
    render(shown);
    const nowArmed = shown >= ARM_PX;
    if (nowArmed && !armed) haptic('light');
    armed = nowArmed;
  }

  function end() {
    if (!start) return;
    const fire = intent === 'swipe' && armed;
    start = null;
    intent = '';
    reset(true);
    if (fire) opts.onreply();
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  return {
    update(next: Options) {
      opts = next;
    },
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      icon?.remove();
    },
  };
}
