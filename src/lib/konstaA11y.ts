import type { Attachment } from 'svelte/attachments';

export const asButton: Attachment<HTMLElement> = (node) => {
  node.setAttribute('role', 'button');
};

export const asMenu: Attachment<HTMLElement> = (node) => {
  node.setAttribute('role', 'menu');
  node.querySelector(':scope > ul')?.setAttribute('role', 'none');
};

export function asSwitch(name: string): Attachment<HTMLElement> {
  return (node) => {
    const input = node.querySelector('input');
    if (!input) return;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', name);
  };
}

export function asSlider(valueText: string): Attachment<HTMLElement> {
  return (node) => {
    node.querySelector('input[type="range"]')?.setAttribute('aria-valuetext', valueText);
  };
}

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
