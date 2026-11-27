import { hapticAllowed, isIosTouch, noteNativeHapticTick, type HapticKind } from './haptics';

export function hapticTap(node: HTMLElement, kind: HapticKind = 'light') {
  if (typeof document === 'undefined' || !isIosTouch()) return;

  if (getComputedStyle(node).position === 'static') node.style.position = 'relative';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.display = 'none';

  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.tabIndex = -1;
  Object.assign(label.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    opacity: '0',
    border: 'none',
    background: 'transparent',
    cursor: 'inherit',
    borderRadius: 'inherit',
    touchAction: 'manipulation',
    zIndex: '1',
  });
  label.appendChild(input);

  label.addEventListener(
    'click',
    (event) => {
      const disabled = node instanceof HTMLButtonElement && node.disabled;
      if (disabled || !hapticAllowed(kind)) {
        event.preventDefault();
        return;
      }
      noteNativeHapticTick();
    },
    true,
  );
  input.addEventListener('click', (event) => event.stopPropagation());

  // Insert as the first child (insertBefore, not prepend — the Cloudflare
  // workers-types Element.prepend overload collides with the DOM one) so
  // Svelte's own child reconciliation ranges are never disturbed.
  node.insertBefore(label, node.firstChild);

  return {
    destroy() {
      label.remove();
    },
  };
}
