import type { Attachment } from 'svelte/attachments';

/** Konsta's Link hard-codes role="link"; a back control rendered as <button> must announce as a button. */
export const asButton: Attachment<HTMLElement> = (node) => {
  node.setAttribute('role', 'button');
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
