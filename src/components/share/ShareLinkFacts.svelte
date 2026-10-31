<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from '../../lib/t';

  export let dict: Record<string, string>;
  export let locale = 'en';
  /** Unix seconds. */
  export let expires: number | undefined = undefined;
  export let burn = false;

  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => { timer = setInterval(() => { now = Date.now(); }, 30_000); });
  onDestroy(() => clearInterval(timer));

  function when(unix: number): string {
    try {
      return new Date(unix * 1000).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return new Date(unix * 1000).toLocaleString();
    }
  }

  $: expired = expires !== undefined && expires * 1000 <= now;
</script>

{#if expires !== undefined || burn}
  <div class="grid gap-2">
    {#if expires !== undefined}
      <p class={expired ? 'status status--error' : 'status'}>{t(dict, expired ? 'shareLink.expired' : 'shareLink.availableUntil').replace('{time}', when(expires))}</p>
    {/if}
    {#if burn && !expired}
      <p class="status status--warn">{t(dict, 'shareLink.burn')}</p>
    {/if}
  </div>
{/if}
