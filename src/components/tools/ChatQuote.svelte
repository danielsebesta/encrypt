<script lang="ts">
  import { t } from '../../lib/t';

  let { dict, name, color, text, onjump, oncancel }: {
    dict: Record<string, string>;
    name: string;
    color: string;
    text: string;
    onjump?: () => void;
    oncancel?: () => void;
  } = $props();
</script>

<div class="msg-quote" class:msg-quote--composer={Boolean(oncancel)}>
  {#if onjump}
    <button type="button" class="msg-quote__body" onclick={onjump} title={t(dict, 'chat.replyJump')}>
      {#if name}<span class="msg-quote__name" style="color: {color}">{name}</span>{/if}
      <span class="msg-quote__text">{text}</span>
    </button>
  {:else}
    <div class="msg-quote__body">
      {#if name}<span class="msg-quote__name" style="color: {color}">{oncancel ? t(dict, 'chat.replyingTo').replace('{name}', name) : name}</span>{/if}
      <span class="msg-quote__text">{text}</span>
    </div>
  {/if}
  {#if oncancel}
    <button type="button" class="btn-ghost btn-sm btn-icon" onclick={oncancel} aria-label={t(dict, 'chat.replyCancel')} title={t(dict, 'chat.replyCancel')}>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  {/if}
</div>

<style>
  .msg-quote {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0.2rem 0 0.3rem;
    border-left: 3px solid var(--accent-line);
    border-radius: 0.35rem;
    background: var(--surface-2);
    min-width: 0;
  }
  .msg-quote--composer {
    margin: 0;
    padding-right: 0.25rem;
  }
  .msg-quote__body {
    display: grid;
    flex: 1;
    min-width: 0;
    padding: 0.3rem 0.5rem;
    text-align: left;
    font-size: 0.78rem;
    line-height: 1.3;
  }
  button.msg-quote__body {
    border-radius: 0 0.35rem 0.35rem 0;
  }
  button.msg-quote__body:hover .msg-quote__text {
    color: var(--text);
  }
  .msg-quote__name {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg-quote__text {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
