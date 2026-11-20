import type { Attachment } from 'svelte/attachments';

/** Konsta's Link hard-codes role="link"; a back control rendered as <button> must announce as a button. */
export const asButton: Attachment<HTMLElement> = (node) => {
  node.setAttribute('role', 'button');
};

/** Konsta's MenuList puts its items in a bare <ul>; inside a menu that list has to be presentational. */
export const asMenu: Attachment<HTMLElement> = (node) => {
  node.setAttribute('role', 'menu');
  node.querySelector(':scope > ul')?.setAttribute('role', 'none');
};

/** Konsta's Toggle wraps an unnamed checkbox in a <label>; expose that input as a named switch. */
export function asSwitch(name: string): Attachment<HTMLElement> {
  return (node) => {
    const input = node.querySelector('input');
    if (!input) return;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', name);
  };
}

/** Konsta's Range spreads attributes on its wrapper; the native slider inside needs the spoken value. */
export function asSlider(valueText: string): Attachment<HTMLElement> {
  return (node) => {
    node.querySelector('input[type="range"]')?.setAttribute('aria-valuetext', valueText);
  };
}

/** Konsta's ListInput renders its own input and error line; tie them together while the error shows. */
export function asFieldError(errorId: string | null): Attachment<HTMLElement> {
  return (node) => {
    const input = node.querySelector('input, textarea');
    if (!input) return;
    if (errorId) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', errorId);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  };
}
