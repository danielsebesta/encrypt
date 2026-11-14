<script lang="ts">
  import { t } from '../../lib/t';
  import { asciiKit, glAvailable } from '../../lib/asciiKit';
  import type { ReactionEmoji, ReactionSummary } from '../../lib/chatReactions';

  let { dict, items, ontoggle }: {
    dict: Record<string, string>;
    items: ReactionSummary[];
    ontoggle: (emoji: ReactionEmoji) => void;
  } = $props();

  const HEART = '❤️';
  const bursts = new WeakMap<HTMLElement, { burst(): void; undo(): void }>();

  function heartBurst(node: HTMLElement, emoji: string) {
    return asciiKit(node, (kit, el) => {
      if (emoji !== HEART || !glAvailable()) return null;
      const made = kit.likeBurst(el, { kind: 'heart', icon: '[data-emoji]', manage: false, outset: 28, ink: el.closest('.chat-bubble--mine, .chat-kmsg--mine') ? 'var(--on-accent)' : 'var(--accent)', limit: el.closest<HTMLElement>('.chat-bubble, .chat-kmsg'), look: { cellSize: 6 } });
      bursts.set(el, made);
      return { destroy() { bursts.delete(el); clearTimeout(pending.get(el)); pending.delete(el); made.destroy(); } };
    });
  }

  const busy = new WeakSet<HTMLElement>();
  const pending = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

  function press(item: ReactionSummary, node: HTMLElement) {
    const burst = bursts.get(node);
    if (!burst) {
      ontoggle(item.emoji);
      return;
    }
    if (busy.has(node)) return;
    busy.add(node);
    setTimeout(() => busy.delete(node), 650);
    try { if (item.mine) burst.undo(); else burst.burst(); } catch {}
    if (item.mine) {
      pending.set(node, setTimeout(() => {
        pending.delete(node);
        if (items.some((entry) => entry.emoji === item.emoji && entry.mine)) ontoggle(item.emoji);
      }, 320));
    } else ontoggle(item.emoji);
  }

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
        use:heartBurst={item.emoji}
        onclick={(event) => press(item, event.currentTarget)}
      >
        <span aria-hidden="true" data-emoji>{item.emoji}</span>
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
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .msg-reactions__chip--mine .msg-reactions__count {
    color: var(--accent-strong);
  }
  @media (prefers-reduced-motion: reduce) {
    .msg-reactions__chip { transition: none; }
  }
</style>
