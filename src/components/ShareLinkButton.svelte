<script lang="ts">
  import { onMount } from 'svelte';

  export let url = '';
  export let title = '';
  export let text = '';
  export let label = '';
  export let hint = '';
  export let className = 'btn-ghost btn-sm';
  export let iconOnly = false;
  export let size = 16;

  let supported = false;

  function payload(shareUrl = url): ShareData {
    const data: ShareData = { url: shareUrl };
    if (title) data.title = title;
    if (text) data.text = text;
    return data;
  }

  onMount(() => {
    if (typeof navigator.share !== 'function') return;
    try {
      const probe = payload(url || location.href);
      supported = !navigator.canShare || navigator.canShare(probe);
    } catch {
      supported = false;
    }
  });

  async function share() {
    if (!url || typeof navigator.share !== 'function') return;
    try {
      await navigator.share(payload());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
</script>

{#if supported}
  <button
    type="button"
    class={className}
    class:btn-icon={iconOnly}
    on:click={share}
    disabled={!url}
    aria-label={iconOnly ? label : undefined}
    title={iconOnly ? label : undefined}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
    {#if !iconOnly}<span>{label}</span>{/if}
  </button>
  {#if hint}
    <p class="hint">{hint}</p>
  {/if}
{/if}
