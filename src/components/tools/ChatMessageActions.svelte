<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';
  import { REACTION_EMOJI, type ReactionEmoji } from '../../lib/chatReactions';
  import { menu } from '../ui/menu';

  let { dict, open, align = 'start', mine = [], canBurn = false, ontoggle, onreply, onreact, onmore, onburn }: {
    dict: Record<string, string>;
    open: boolean;
    align?: 'start' | 'end';
    mine?: ReactionEmoji[];
    canBurn?: boolean;
    ontoggle: (open: boolean) => void;
    onreply: () => void;
    onreact: (emoji: ReactionEmoji) => void;
    onmore?: (anchor: HTMLElement) => void;
    onburn?: () => void;
  } = $props();

  let rootEl: HTMLDivElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLDivElement | undefined = $state();
  let upward = $state(false);

  $effect(() => {
    if (!open) return;
    upward = roomAbove();
    void tick().then(fitMenu);
  });

  function fitMenu() {
    const menu = menuEl;
    const cb = menu?.offsetParent as HTMLElement | null;
    if (!menu || !cb) return;
    const vw = window.innerWidth;
    const cbRect = cb.getBoundingClientRect();
    const bubbleRect = cb.offsetParent?.getBoundingClientRect();
    const r = menu.getBoundingClientRect();
    let left = r.left;
    if (align === 'end' && bubbleRect) left = Math.min(bubbleRect.right, vw - 8) - r.width;
    else if (bubbleRect) left = Math.max(bubbleRect.left, 8);
    const desired = Math.min(Math.max(left, 8), Math.max(8, vw - 8 - r.width));
    if (Math.abs(desired - r.left) > 0.5) {
      menu.style.left = `${desired - cbRect.left}px`;
      menu.style.right = 'auto';
    }
  }

  function roomAbove(): boolean {
    if (!triggerEl) return false;
    let box = { top: 0, bottom: window.innerHeight };
    for (let el = triggerEl.parentElement; el; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
        const rect = el.getBoundingClientRect();
        box = { top: Math.max(box.top, rect.top), bottom: Math.min(box.bottom, rect.bottom) };
        break;
      }
    }
    const rect = triggerEl.getBoundingClientRect();
    return rect.top - box.top > box.bottom - rect.bottom;
  }

  function close(refocus: boolean) {
    ontoggle(false);
    if (refocus) triggerEl?.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const items = [...(menuEl?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    items[(at + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  function onfocusout(event: FocusEvent) {
    if (open && !rootEl?.contains(event.relatedTarget as Node | null)) ontoggle(false);
  }
</script>

<div class="msg-actions" class:msg-actions--open={open} bind:this={rootEl} {onfocusout}>
  <button
    type="button"
    class="btn-ghost btn-sm btn-icon msg-actions__trigger"
    bind:this={triggerEl}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={t(dict, 'chat.messageActions')}
    title={t(dict, 'chat.messageActions')}
    onclick={() => ontoggle(!open)}
  >
    <Icon name="ellipsis" />
  </button>
  {#if open}
    <div
      class="menu menu--open msg-actions__menu"
      class:msg-actions__menu--up={upward}
      class:msg-actions__menu--end={align === 'end'}
      role="menu"
      tabindex="-1"
      aria-label={t(dict, 'chat.messageActions')}
      bind:this={menuEl}
      use:menu={{ open, onclose: () => ontoggle(false), trigger: triggerEl }}
      {onkeydown}
    >
      <div class="msg-actions__emoji">
        {#each REACTION_EMOJI as emoji}
          <button
            type="button"
            role="menuitemcheckbox"
            class="btn-ghost btn-icon msg-actions__react"
            aria-checked={mine.includes(emoji)}
            aria-label={t(dict, 'chat.reactWith').replace('{emoji}', emoji)}
            title={t(dict, 'chat.reactWith').replace('{emoji}', emoji)}
            onclick={() => { onreact(emoji); close(true); }}
          >{emoji}</button>
        {/each}
        {#if onmore}
          <button
            type="button"
            role="menuitem"
            class="btn-ghost btn-icon chat-emoji-btn"
            aria-label={t(dict, 'chat.reactMore')}
            title={t(dict, 'chat.reactMore')}
            onclick={() => { const anchor = triggerEl; ontoggle(false); if (anchor) onmore(anchor); }}
          ><Icon name="smile-plus" /></button>
        {/if}
      </div>
      <div class="menu__sep" role="separator"></div>
      <button type="button" role="menuitem" class="menu__item" onclick={() => { ontoggle(false); onreply(); }}>
        <Icon name="reply" />
        <span>{t(dict, 'chat.reply')}</span>
      </button>
      {#if canBurn && onburn}
        <button type="button" role="menuitem" class="menu__item menu__item--danger" onclick={() => { ontoggle(false); onburn(); }}>
          <Icon name="trash" />
          <span>{t(dict, 'chat.burnForEveryone')}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .msg-actions {
    margin-left: auto;
    flex-shrink: 0;
  }
  .msg-actions__trigger {
    margin: -0.375rem 0;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-out);
  }
  .msg-actions--open .msg-actions__trigger,
  .msg-actions__trigger:focus-visible,
  :global(.chat-bubble:hover) .msg-actions__trigger,
  :global(.chat-bubble:focus-within) .msg-actions__trigger {
    opacity: 1;
  }
  @media (hover: none) {
    .msg-actions__trigger { opacity: 1; }
  }
  .msg-actions__menu {
    left: 0.25rem;
    top: 2.1rem;
    margin: 0;
    min-width: 0;
    width: max-content;
    max-width: calc(100vw - 1rem);
    max-height: min(70dvh, 24rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .msg-actions__menu--end {
    left: auto;
    right: 0.25rem;
  }
  .msg-actions__menu--up {
    top: auto;
    bottom: calc(100% - 0.25rem);
  }
  .msg-actions__emoji {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .msg-actions__react {
    font-size: 1.25rem;
    line-height: 1;
  }
  .msg-actions__react[aria-checked="true"] {
    --btn-fg: var(--accent-strong);
    border-color: var(--accent-line);
    background: var(--accent-weak);
  }
</style>
