import { hapticAllowed, isIosTouch, noteNativeHapticTick, type HapticKind } from './haptics';

/**
 * Real-gesture haptic overlay, mirroring the ios-vibrator-pro-max
 * click-passthrough technique that keeps working on every iOS build: the
 * system haptic plays when a real tap activates a `<label>` wired to a hidden
 * `<input switch>` — label activation, not a tap on the bare input and not a
 * programmatic `label.click()` (the post-gesture grant is no longer honored on
 * every iOS 18.4+/26 build). An invisible label is layered over the button;
 * the user's own tap activates it (toggling the hidden switch → system
 * haptic) and the click still bubbles to the button, so its handler and
 * :active styling keep working. When the preference does not allow this kind
 * the activation is cancelled with preventDefault — silent, but the click
 * passes.
 *
 * The guard runs in the capture phase, before the button's own click handler,
 * so a handler that also calls `haptic()` is deduped against the native tick
 * (see noteNativeHapticTick).
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
        // Cancel the label activation: the hidden switch never toggles, no haptic.
        // The click still bubbles to the button.
        event.preventDefault();
        return;
      }
      noteNativeHapticTick();
    },
    true,
  );
  // Label activation re-dispatches a click on the input; it must not bubble
  // back to the button and run its handler a second time. The toggle itself
  // (the input's default action) still runs.
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
