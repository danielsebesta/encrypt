import { tick } from 'svelte';

export async function focusFirstInvalid(root: ParentNode | null | undefined) {
  await tick();
  root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
