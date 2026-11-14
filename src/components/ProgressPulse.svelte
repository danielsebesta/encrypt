<script lang="ts">
  import { onMount } from 'svelte';

  export let title = '';
  export let detail = '';
  export let compact = false;
  /** 0–1 when known; omit for indeterminate busy state. */
  export let ratio: number | null = null;
  /** Secondary line: bytes, speed, ETA, online/offline. */
  export let transferLine = '';
  export let state: 'loading' | 'success' | 'error' = 'loading';

  let orbEl: HTMLSpanElement | undefined;
  let orbOn = false;
  let handle: { supported: boolean; loading(): void; success(): void; error(): void; destroy(): void } | null = null;

  onMount(() => {
    if (compact || !orbEl || matchMedia('(prefers-reduced-data: reduce)').matches) return;
    let gone = false;
    import('asciify-engine/kit').then(({ statusOrb }) => {
      if (gone || !orbEl) return;
      const orb = statusOrb(orbEl, { ring: true, colourByState: true, ink: 'var(--accent)', colors: { success: 'var(--accent)', error: 'var(--danger)', warning: 'var(--warn)' }, lazy: false });
      if (!orb.supported) { orb.destroy(); return; }
      handle = orb;
      orbOn = true;
      applyState(state);
    });
    return () => {
      gone = true;
      handle?.destroy();
    };
  });

  function applyState(next: typeof state) {
    if (!handle) return;
    if (next === 'success') handle.success();
    else if (next === 'error') handle.error();
    else handle.loading();
  }
  $: applyState(state);

  let phaseKey = '';
  let livePct = -1;

  $: nextPhase = `${title}\0${detail}`;
  $: if (nextPhase !== phaseKey) {
    phaseKey = nextPhase;
    livePct = -1;
  }

  $: pctBucket = ratio == null ? -1 : Math.floor((ratio * 100) / 25) * 25;
  $: if (pctBucket >= 25 && pctBucket > livePct) {
    livePct = pctBucket;
  }
</script>

<div class="status status--busy" class:status--orb={orbOn}>
  {#if !compact}<span bind:this={orbEl} class="status__orb" aria-hidden="true"></span>{/if}
  <div class="status__body">
    <div role="status" aria-live="polite">
      <p class="status__title">{title}</p>
      {#if detail && !compact}
        <p class="status__detail">{detail}</p>
      {/if}
      {#if livePct >= 25}
        <span class="sr-only">{livePct}%</span>
      {/if}
    </div>
    {#if ratio != null || transferLine}
      <div class="status__transfer">
        {#if ratio != null}
          <progress class="status__bar" max="1" value={ratio} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}></progress>
        {/if}
        {#if transferLine}
          <p class="status__transfer-line">{transferLine}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
