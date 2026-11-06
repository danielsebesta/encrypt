<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';

  /** Final cover text once ready; empty while still computing. */
  export let target = '';
  /** Show a waiting caret before the target arrives. */
  export let waiting = false;
  export let labelledby = '';

  const dispatch = createEventDispatcher<{ done: void }>();
  /** Whole reveal should feel like a quick flourish, not a real stream. */
  const TOTAL_MS = 380;

  let visible = '';
  let streaming = false;
  let streamTarget = '';
  let raf = 0;
  let started = 0;
  let reduced = false;

  $: if (typeof window !== 'undefined') {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  $: sync(waiting, target);

  function sync(_isWaiting: boolean, next: string) {
    if (typeof window === 'undefined') return;
    if (next) {
      startStream(next);
      return;
    }
    stop();
    visible = '';
    streaming = false;
    streamTarget = '';
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function startStream(text: string) {
    if (streamTarget === text && (streaming || visible === text)) return;
    stop();
    streamTarget = text;
    if (reduced) {
      visible = text;
      streaming = false;
      dispatch('done');
      return;
    }
    streaming = true;
    visible = '';
    started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / TOTAL_MS);
      // Ease-out so the last bits land quickly.
      const eased = 1 - (1 - t) * (1 - t);
      const at = Math.min(text.length, Math.ceil(text.length * eased));
      visible = text.slice(0, at);
      if (t < 1) {
        raf = requestAnimationFrame(step);
        return;
      }
      visible = text;
      streaming = false;
      raf = 0;
      dispatch('done');
    };
    raf = requestAnimationFrame(step);
  }

  onDestroy(stop);
</script>

{#if waiting || visible}
  <output
    class="output output--ok cipher-cover"
    class:cipher-stream={waiting || streaming}
    aria-labelledby={labelledby}
    aria-live="polite"
    aria-busy={waiting || streaming}
  >{visible}<span class="cipher-caret" class:cipher-caret--on={waiting || streaming} aria-hidden="true"></span></output>
{/if}

<style>
  :global(.cipher-cover) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .cipher-caret {
    display: none;
  }

  .cipher-caret--on {
    display: inline-block;
    width: 0.55ch;
    height: 1.05em;
    margin-left: 1px;
    vertical-align: text-bottom;
    background: var(--text);
    animation: cipher-caret-blink 0.9s steps(1, end) infinite;
  }

  @keyframes cipher-caret-blink {
    0%,
    49% {
      opacity: 1;
    }
    50%,
    100% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cipher-caret--on {
      animation: none;
      opacity: 1;
    }
  }
</style>
