<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/t';
  import { REACTION_EMOJI, type ReactionEmoji } from '../../lib/chatReactions';

  let { dict, open, align = 'start', mine = [], ontoggle, onreply, onreact }: {
    dict: Record<string, string>;
    open: boolean;
    align?: 'start' | 'end';
    mine?: ReactionEmoji[];
    ontoggle: (open: boolean) => void;
    onreply: () => void;
    onreact: (emoji: ReactionEmoji) => void;
  } = $props();

  let rootEl: HTMLDivElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLDivElement | undefined = $state();
  let upward = $state(false);

  $effect(() => {
    if (!open) return;
    upward = roomAbove();
    void tick().then(() => menuEl?.querySelector<HTMLElement>('button')?.focus());
  });

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
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
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
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
        <span>{t(dict, 'chat.reply')}</span>
      </button>
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
    width: 1.75rem;
    height: 1.5rem;
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
    gap: 2px;
  }
  .msg-actions__react {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
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
  .msg-actions__reply {
    width: 100%;
    min-height: 2.25rem;
  }
</style>
