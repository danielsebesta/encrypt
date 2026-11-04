<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/t';
  import { LUCIDE } from '../../lib/lucideIcons';
  import { REACTION_EMOJI, type ReactionEmoji } from '../../lib/chatReactions';

  let { dict, open, align = 'start', mine = [], canBurn = false, ontoggle, onreply, onreact, onburn }: {
    dict: Record<string, string>;
    open: boolean;
    align?: 'start' | 'end';
    mine?: ReactionEmoji[];
    canBurn?: boolean;
    ontoggle: (open: boolean) => void;
    onreply: () => void;
    onreact: (emoji: ReactionEmoji) => void;
    onburn?: () => void;
  } = $props();

  let rootEl: HTMLDivElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLDivElement | undefined = $state();
  let upward = $state(false);

  $effect(() => {
    if (!open) return;
    upward = roomAbove();
    void tick().then(() => {
      menuEl?.querySelector<HTMLElement>('button')?.focus();
      fitMenu();
    });
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
    const items = [...(menuEl?.querySelectorAll<HTMLElement>('button') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      items[(at + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(at - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  }

  function onfocusout(event: FocusEvent) {
    if (open && !rootEl?.contains(event.relatedTarget as Node | null)) ontoggle(false);
  }
</script>

<div class="msg-actions" class:msg-actions--open={open} bind:this={rootEl} {onfocusout}>
  <button
    type="button"
    class="msg-actions__trigger"
    bind:this={triggerEl}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={t(dict, 'chat.messageActions')}
    title={t(dict, 'chat.messageActions')}
    onclick={() => ontoggle(!open)}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['ellipsis']}</svg>
  </button>
  {#if open}
    <div class="msg-actions__menu" class:msg-actions__menu--up={upward} class:msg-actions__menu--end={align === 'end'} role="menu" tabindex="-1" aria-label={t(dict, 'chat.messageActions')} bind:this={menuEl} {onkeydown}>
      <div class="msg-actions__emoji">
        {#each REACTION_EMOJI as emoji}
          <button
            type="button"
            role="menuitemcheckbox"
            class="msg-actions__react"
            class:msg-actions__react--on={mine.includes(emoji)}
            aria-checked={mine.includes(emoji)}
            aria-label={t(dict, 'chat.reactWith').replace('{emoji}', emoji)}
            title={t(dict, 'chat.reactWith').replace('{emoji}', emoji)}
            onclick={() => { onreact(emoji); close(true); }}
          >{emoji}</button>
        {/each}
      </div>
      <button type="button" role="menuitem" class="menu__item msg-actions__reply" onclick={() => { ontoggle(false); onreply(); }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['reply']}</svg>
        <span>{t(dict, 'chat.reply')}</span>
      </button>
      {#if canBurn && onburn}
        <button type="button" role="menuitem" class="menu__item msg-actions__burn" onclick={() => { ontoggle(false); onburn(); }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['trash']}</svg>
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
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    margin: -0.25rem 0;
    border-radius: 0.4rem;
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out);
  }
  .msg-actions__trigger:hover,
  .msg-actions--open .msg-actions__trigger {
    background: var(--surface-2);
    color: var(--text);
  }
  .msg-actions--open .msg-actions__trigger,
  .msg-actions__trigger:focus-visible,
  :global(.chat-bubble:hover) .msg-actions__trigger,
  :global(.chat-bubble:focus-within) .msg-actions__trigger {
    opacity: 1;
  }
  @media (hover: none) {
    .msg-actions__trigger { opacity: 0.7; }
  }
  .msg-actions__menu {
    position: absolute;
    left: 0.25rem;
    top: 2.1rem;
    z-index: var(--z-menu);
    display: grid;
    gap: 2px;
    padding: 0.3rem;
    width: max-content;
    max-width: calc(100vw - 1rem);
    max-height: min(70dvh, 24rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: 0.65rem;
    background: var(--bg);
    border: 1px solid var(--line-soft);
    box-shadow: var(--shadow-float);
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
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    overflow: hidden;
    border-radius: 0.5rem;
    font-size: 1.15rem;
    line-height: 1;
    transition: background-color var(--duration-fast) var(--ease-out);
  }
  .msg-actions__react:hover,
  .msg-actions__react:focus-visible {
    background: var(--surface-2);
  }
  .msg-actions__react--on {
    background: var(--accent-weak);
  }
  .msg-actions__reply,
  .msg-actions__burn {
    width: 100%;
    min-height: 2.75rem;
  }
  .msg-actions__burn {
    color: var(--danger, #b42318);
  }
</style>
