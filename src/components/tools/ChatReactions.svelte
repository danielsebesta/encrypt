<script lang="ts">
  import { t } from '../../lib/t';
  import { prefersReducedMotion } from '../../lib/appPrefs';
  import type { ReactionEmoji, ReactionSummary } from '../../lib/chatReactions';

  let { dict, appMode = false, items, ontoggle }: {
    dict: Record<string, string>;
    appMode?: boolean;
    items: ReactionSummary[];
    ontoggle: (emoji: ReactionEmoji) => void;
  } = $props();

  const HEART = '❤️';
  const SPARKS = [0, 60, 120, 180, 240, 300];
  let pop = $state<{ emoji: string; n: number } | null>(null);
  let popSeq = 0;

  function press(item: ReactionSummary) {
    if (item.emoji === HEART && !item.mine && !prefersReducedMotion()) pop = { emoji: item.emoji, n: ++popSeq };
    ontoggle(item.emoji);
  }

  const label = (item: ReactionSummary) => t(dict, 'chat.reactionBy').replace('{emoji}', item.emoji).replace('{count}', String(item.count)).replace('{names}', item.names.join(', '));
</script>

{#if items.length}
  <div class="msg-reactions">
    {#each items as item (item.emoji)}
      <button
        type="button"
        class={appMode ? 'msg-reactions__chip' : 'chip msg-reactions__item'}
        class:msg-reactions__chip--mine={appMode && item.mine}
        class:msg-reactions__chip--pop={pop?.emoji === item.emoji}
        aria-pressed={item.mine}
        aria-label={label(item)}
        title={label(item)}
        onclick={() => press(item)}
      >
        <span class="msg-reactions__emoji" aria-hidden="true">{item.emoji}</span>
        {#if pop?.emoji === item.emoji}
          {#key pop.n}
            <span class="msg-reactions__pop" aria-hidden="true" onanimationend={(event) => { if (event.target === event.currentTarget) pop = null; }}>
              {#each SPARKS as angle (angle)}
                <span class="msg-reactions__spark" style="--spark-a: {angle}deg"></span>
              {/each}
            </span>
          {/key}
        {/if}
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
  .msg-reactions__item {
    position: relative;
    gap: 0.25rem;
    padding: 0 0.5rem;
  }
  .msg-reactions__chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 1.6rem;
    padding: 0 0.45rem;
    border-radius: 6px;
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
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  [aria-pressed="true"] .msg-reactions__count {
    color: var(--accent-strong);
  }
  .msg-reactions__emoji {
    display: inline-block;
  }
  .msg-reactions__chip--pop .msg-reactions__emoji {
    animation: msg-reaction-pop var(--duration-slow) var(--ease-out);
  }
  .msg-reactions__pop {
    position: absolute;
    top: 50%;
    left: 0.85rem;
    width: 0;
    height: 0;
    pointer-events: none;
    animation: msg-reaction-hold var(--duration-slow) linear;
  }
  .msg-reactions__spark {
    position: absolute;
    top: -3px;
    left: -3px;
    width: 6px;
    height: 6px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0;
    animation: msg-reaction-spark var(--duration-slow) var(--ease-out);
  }
  :global(.chat-bubble--mine) .msg-reactions__spark,
  :global(.chat-kmsg--mine) .msg-reactions__spark {
    border: 1px solid var(--accent);
    background: var(--on-accent);
  }
  @keyframes msg-reaction-pop {
    0% { transform: scale(1); }
    40% { transform: scale(1.35); }
    100% { transform: scale(1); }
  }
  @keyframes msg-reaction-hold {
    from { opacity: 1; }
    to { opacity: 1; }
  }
  @keyframes msg-reaction-spark {
    0% { opacity: 1; transform: rotate(var(--spark-a)) translateY(-8px) scale(1); }
    55% { opacity: 1; }
    100% { opacity: 0; transform: rotate(var(--spark-a)) translateY(-19px) scale(0.5); }
  }
  @media (prefers-reduced-motion: reduce) {
    .msg-reactions__chip--pop .msg-reactions__emoji,
    .msg-reactions__pop,
    .msg-reactions__spark { animation: none; }
    .msg-reactions__pop { display: none; }
  }
  :global(:root[data-app-reduce-motion="1"]) .msg-reactions__chip--pop .msg-reactions__emoji,
  :global(:root[data-app-reduce-motion="1"]) .msg-reactions__spark { animation: none; }
  :global(:root[data-app-reduce-motion="1"]) .msg-reactions__pop { display: none; }
</style>
