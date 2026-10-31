<script lang="ts">
  export let title = '';
  export let detail = '';
  export let compact = false;
  /** 0–1 when known; omit for indeterminate busy state. */
  export let ratio: number | null = null;
  /** Secondary line: bytes, speed, ETA, online/offline. */
  export let transferLine = '';
</script>

<div class="status status--busy" role="status" aria-live="polite" aria-busy="true">
  <div class="status__body">
    <p class="status__title">{title}</p>
    {#if detail && !compact}
      <p class="status__detail">{detail}</p>
    {/if}
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
