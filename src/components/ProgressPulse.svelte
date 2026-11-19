<script lang="ts">
  import Icon from './Icon.svelte';

  export let title = '';
  export let detail = '';
  export let compact = false;
  /** 0–1 when known; omit for indeterminate busy state. */
  export let ratio: number | null = null;
  /** Secondary line: bytes, speed, ETA, online/offline. */
  export let transferLine = '';
  export let state: 'loading' | 'success' | 'error' = 'loading';
  /** Set false when another element shows the progress: no ring, no spinner. */
  export let orb = true;
  /** Set false to keep the progress value for screen readers only. */
  export let bar = true;

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

<div class="status status--busy" class:status--orb={!compact || !orb}>
  {#if !compact && orb}
    <span class="status__ring status__ring--{state}" aria-hidden="true">
      {#if state === 'success'}<Icon name="check" size={20} />{:else if state === 'error'}<Icon name="x" size={20} />{/if}
    </span>
  {/if}
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
          <progress class="progress" class:sr-only={!bar} max="1" value={ratio} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}></progress>
        {/if}
        {#if transferLine}
          <p class="status__transfer-line">{transferLine}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
