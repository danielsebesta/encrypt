import { hapticAllowed, isIosTouch, noteNativeHapticTick, type HapticKind } from './haptics';

/**
 * Real-gesture haptic overlay, the technique that keeps working on every iOS
 * build (the ios-vibrator-pro-max insight): iOS plays a system haptic when a
 * real user interaction toggles a native `<input switch>` — but on iOS 18.4+/26
 * a programmatic `label.click()` inside the post-gesture grant is not honored
 * on every build. So the tap itself does the toggling: an invisible switch is
 * layered over the button, the user's own tap flips it (system haptic, no
 * grant needed) and the click still bubbles to the button, so its handler and
 * :active styling keep working. When the preference does not allow this kind
 * the toggle is cancelled with preventDefault — silent, but the click passes.
 *
 * Install only on iOS touch devices; elsewhere haptics go through
 * `navigator.vibrate` from the button's own click handler.
 */
export function hapticTap(node: HTMLElement, kind: HapticKind = 'light') {
  if (typeof document === 'undefined' || !isIosTouch()) return;

  if (getComputedStyle(node).position === 'static') node.style.position = 'relative';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  Object.assign(input.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    opacity: '0',
    appearance: 'none',
    WebkitAppearance: 'none',
    border: 'none',
    background: 'transparent',
    cursor: 'inherit',
    borderRadius: 'inherit',
    touchAction: 'manipulation',
    zIndex: '1',
  });
  input.addEventListener(
    'click',
    (event) => {
      const disabled = node instanceof HTMLButtonElement && node.disabled;
      if (disabled || !hapticAllowed(kind)) {
        // Cancel the switch toggle: no haptic. The click still bubbles to the button.
        event.preventDefault();
        return;
      }
      noteNativeHapticTick();
    },
    true,
  );
  // Insert as the first child (insertBefore, not prepend — the Cloudflare
  // workers-types Element.prepend overload collides with the DOM one) so
  // Svelte's own child reconciliation ranges are never disturbed.
  node.insertBefore(input, node.firstChild);

  return {
    destroy() {
      input.remove();
    },
  };
}
