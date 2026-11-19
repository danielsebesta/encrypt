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

  const uid = id ?? `modal-${Math.random().toString(36).slice(2, 10)}`;
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;

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

<style>
  :global(html.modal-open) {
    overflow: hidden;
  }

  .modal {
    width: min(var(--modal-w), calc(100vw - 2rem));
    max-width: none;
    max-height: calc(100dvh - 2rem);
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    text-align: left;
    box-shadow: var(--shadow-float);
    opacity: 0;
    transform: translateY(0.5rem);
    transition:
      opacity var(--duration-dialog) var(--ease-out),
      transform var(--duration-dialog) var(--ease-out),
      overlay var(--duration-dialog) allow-discrete,
      display var(--duration-dialog) allow-discrete;
  }
  .modal--sm { --modal-w: 24rem; }
  .modal--md { --modal-w: 32rem; }
  .modal--lg { --modal-w: 44rem; }

  .modal[open] {
    display: flex;
    opacity: 1;
    transform: none;
  }
  @starting-style {
    .modal[open] {
      opacity: 0;
      transform: translateY(0.5rem);
    }
  }

  .modal::backdrop {
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    opacity: 0;
    transition:
      opacity var(--duration-dialog) var(--ease-out),
      overlay var(--duration-dialog) allow-discrete,
      display var(--duration-dialog) allow-discrete;
  }
  .modal[open]::backdrop {
    opacity: 1;
  }
  @starting-style {
    .modal[open]::backdrop {
      opacity: 0;
    }
  }

  .modal__panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
    outline: none;
  }

  .modal__header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1.25rem 1.25rem 0;
  }
  .modal__titles {
    display: grid;
    flex: 1;
    gap: 0.25rem;
    min-width: 0;
  }
  .modal__eyebrow {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--muted);
  }
  .modal__title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    line-height: 1.35;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .modal__description {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--muted);
  }
  .modal__icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
  }
  .modal__icon--danger {
    background: var(--danger-weak);
    color: var(--danger);
  }
  .modal__icon--warn {
    background: var(--warn-weak);
    color: var(--warn);
  }
  .modal__close {
    flex: none;
    margin: -0.375rem -0.5rem 0 0;
  }

  .modal__body {
    display: grid;
    gap: 1rem;
    min-height: 0;
    padding: 1rem 1.25rem 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .modal__footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding: 1.25rem;
  }
  .modal__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .modal__aside {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-left: auto;
  }

  @media (min-width: 768px) {
    .modal__header { padding: 1.5rem 1.5rem 0; }
    .modal__body { padding: 1rem 1.5rem 0; }
    .modal__footer { padding: 1.5rem; }
  }

  @media (max-width: 639px) {
    .modal {
      width: 100%;
      max-height: calc(100dvh - 1rem);
      margin: auto 0 0;
      border-width: 1px 0 0;
      border-radius: 12px 12px 0 0;
      transform: translateY(1.5rem);
    }
    @starting-style {
      .modal[open] {
        transform: translateY(1.5rem);
      }
    }
    .modal__footer {
      padding-bottom: calc(1.25rem + env(safe-area-inset-bottom));
    }
    .modal__actions,
    .modal__aside {
      width: 100%;
      margin: 0;
    }
    .modal__actions {
      flex-direction: column;
    }
    .modal__actions > :global(*),
    .modal__aside > :global(*) {
      flex: 1 1 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal,
    .modal::backdrop {
      transition: none;
      transform: none;
    }
  }

  @media (forced-colors: active) {
    .modal {
      border: 1px solid CanvasText;
    }
  }
</style>
