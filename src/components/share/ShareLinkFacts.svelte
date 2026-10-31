<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from '../../lib/t';

  export let dict: Record<string, string>;
  export let locale = 'en';
  /** Unix seconds. */
  export let expires: number | undefined = undefined;
  export let burn = false;
  /** When the time lock opens, in milliseconds. */
  export let unlock: number | undefined = undefined;

  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => { timer = setInterval(() => { now = Date.now(); }, 15_000); });
  onDestroy(() => clearInterval(timer));

  function when(ms: number): string {
    try {
      return new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return new Date(ms).toLocaleString();
    }
  }

  $: expired = expires !== undefined && expires * 1000 <= now;
  $: locked = unlock !== undefined && unlock > now;
</script>

{#if expires !== undefined || burn || locked}
  <div class="grid gap-2">
    {#if locked && unlock !== undefined}
      <p class="status status--warn">{t(dict, 'shareLink.lockedUntil').replace('{time}', when(unlock))}</p>
    {/if}
    {#if expires !== undefined}
      <p class={expired ? 'status status--error' : 'status'}>{t(dict, expired ? 'shareLink.expired' : 'shareLink.availableUntil').replace('{time}', when(expires * 1000))}</p>
    {/if}
    {#if burn && !expired}
      <p class="status status--warn">{t(dict, 'shareLink.burn')}</p>
    {/if}
  </div>
{/if}
