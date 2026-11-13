<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';

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
    <Icon name="share-2" size={size <= 15 ? 16 : 20} />
    {#if !iconOnly}<span>{label}</span>{/if}
  </button>
  {#if hint}
    <p class="hint">{hint}</p>
  {/if}
{/if}
