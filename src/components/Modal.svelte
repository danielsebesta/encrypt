<script module lang="ts">
  let openCount = 0;

  function lockScroll(lock: boolean) {
    openCount = Math.max(0, openCount + (lock ? 1 : -1));
    document.documentElement.classList.toggle('modal-open', openCount > 0);
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from '../lib/iconManifest';
  import { t } from '../lib/t';

  interface Props {
    open?: boolean;
    dict: Record<string, string>;
    title: string;
    /** Short line under the title; also the dialog's accessible description. */
    description?: string;
    /** Small label above the title. */
    eyebrow?: string;
    icon?: IconName;
    tone?: 'default' | 'danger' | 'warn';
    /** `alertdialog` for confirmations that interrupt the user and need an answer. */
    role?: 'dialog' | 'alertdialog';
    size?: 'sm' | 'md' | 'lg';
    /** Escape, the close button and a click outside close it. */
    dismissible?: boolean;
    closeButton?: boolean;
    /** While busy nothing closes the dialog and the panel reports aria-busy. */
    busy?: boolean;
    /** Wraps the body and actions in a form: Enter in a field and Ctrl/Cmd+Enter anywhere submit it. */
    onsubmit?: (event: SubmitEvent) => void;
    onclose?: () => void;
    /** Selector inside the dialog to focus on open; defaults to [autofocus], then the first field, then the panel. */
    initialFocus?: string;
    id?: string;
    class?: string;
    children?: Snippet;
    actions?: Snippet;
    /** Content on the far side of the action row, such as a destructive secondary action. */
    footer?: Snippet;
  }

  let {
    open = $bindable(false),
    dict,
    title,
    description = '',
    eyebrow = '',
    icon,
    tone = 'default',
    role = 'dialog',
    size = 'md',
    dismissible = true,
    closeButton = true,
    busy = false,
    onsubmit,
    onclose,
    initialFocus,
    id,
    class: className = '',
    children,
    actions,
    footer,
  }: Props = $props();

  const autoId = $props.id();
  const uid = $derived(id ?? `modal-${autoId}`);
  const titleId = $derived(`${uid}-title`);
  const descId = $derived(`${uid}-desc`);

  let dialog = $state<HTMLDialogElement>();
  let form = $state<HTMLFormElement>();
  let opener: HTMLElement | null = null;
  let locked = false;
  let pressOnBackdrop = false;

  const FOCUSABLE = 'input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  function show() {
    if (!dialog || dialog.open) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    if (!locked) { lockScroll(true); locked = true; }
    const target = (initialFocus && dialog.querySelector<HTMLElement>(initialFocus))
      || dialog.querySelector<HTMLElement>('[autofocus]')
      || dialog.querySelector<HTMLElement>(FOCUSABLE)
      || dialog.querySelector<HTMLElement>('.modal__panel');
    target?.focus();
  }

  function release() {
    if (locked) { lockScroll(false); locked = false; }
  }

  $effect(() => {
    if (!dialog) return;
    if (open) show();
    else if (dialog.open) dialog.close();
  });

  $effect(() => () => {
    release();
    if (dialog?.open) dialog.close();
  });

  export function close() {
    if (busy) return;
    open = false;
  }

  function onDialogClose() {
    release();
    open = false;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
    onclose?.();
  }

  function onCancel(event: Event) {
    event.preventDefault();
    if (dismissible) close();
  }

  function onPointerDown(event: PointerEvent) {
    pressOnBackdrop = event.target === dialog;
  }

  function onClick(event: MouseEvent) {
    const outside = pressOnBackdrop && event.target === dialog;
    pressOnBackdrop = false;
    if (outside && dismissible) close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && form && !busy) {
      event.preventDefault();
      form.requestSubmit();
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!busy) onsubmit?.(event);
  }
</script>

{#snippet body()}
  <header class="modal__header">
    {#if icon}
      <span class="modal__icon modal__icon--{tone}" aria-hidden="true"><Icon name={icon} size={20} /></span>
    {/if}
    <div class="modal__titles">
      {#if eyebrow}<p class="modal__eyebrow">{eyebrow}</p>{/if}
      <h2 id={titleId} class="modal__title">{title}</h2>
      {#if description}<p id={descId} class="modal__description">{description}</p>{/if}
    </div>
    {#if closeButton && dismissible}
      <button type="button" class="btn-ghost btn-sm btn-icon modal__close" aria-label={t(dict, 'common.close')} title={t(dict, 'common.close')} disabled={busy} onclick={close}>
        <Icon name="x" size={20} />
      </button>
    {/if}
  </header>
  {#if children}
    <div class="modal__body">{@render children()}</div>
  {/if}
  {#if actions || footer}
    <footer class="modal__footer">
      {#if actions}<div class="modal__actions">{@render actions()}</div>{/if}
      {#if footer}<div class="modal__aside">{@render footer()}</div>{/if}
    </footer>
  {/if}
{/snippet}

<dialog
  bind:this={dialog}
  use:portal
  class="modal modal--{size} {className}"
  {role}
  aria-labelledby={titleId}
  aria-describedby={description ? descId : undefined}
  aria-busy={busy || undefined}
  oncancel={onCancel}
  onclose={onDialogClose}
  onpointerdown={onPointerDown}
  onclick={onClick}
  onkeydown={onKeydown}
>
  {#if onsubmit}
    <form bind:this={form} class="modal__panel" tabindex="-1" onsubmit={submit} novalidate>
      {@render body()}
    </form>
  {:else}
    <div class="modal__panel" tabindex="-1">
      {@render body()}
    </div>
  {/if}
</dialog>
