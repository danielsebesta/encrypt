<script lang="ts">
  import { t } from '../../lib/t';
  import type { ReactionEmoji, ReactionSummary } from '../../lib/chatReactions';

  let { dict, items, ontoggle }: {
    dict: Record<string, string>;
    items: ReactionSummary[];
    ontoggle: (emoji: ReactionEmoji) => void;
  } = $props();

  const label = (item: ReactionSummary) => t(dict, 'chat.reactionBy').replace('{emoji}', item.emoji).replace('{names}', item.names.join(', '));
</script>

{#if items.length}
  <div class="msg-reactions">
    {#each items as item (item.emoji)}
      <button
        type="button"
        class="msg-reactions__chip"
        class:msg-reactions__chip--mine={item.mine}
        aria-pressed={item.mine}
        aria-label={label(item)}
        title={label(item)}
        onclick={() => ontoggle(item.emoji)}
      >
        <span aria-hidden="true">{item.emoji}</span>
        <span class="msg-reactions__count" aria-hidden="true">{item.count}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .msg-reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.35rem;
  }
  .msg-reactions__chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 1.6rem;
    padding: 0 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--line-soft);
    background: var(--bg);
    font-size: 0.8rem;
    line-height: 1;
    transition: border-color var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out);
  }
  .msg-reactions__chip:hover {
    border-color: var(--line);
  }
  .msg-reactions__chip--mine {
    border-color: var(--accent-line);
    background: var(--accent-weak);
  }
  .msg-reactions__count {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .msg-reactions__chip--mine .msg-reactions__count {
    color: var(--accent-strong);
  }
</style>
