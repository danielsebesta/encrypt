<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';

  export let url = '';
  export let title = '';
  export let text = '';
  export let label = '';
  export let copiedLabel = '';
  export let errorLabel = '';
  export let hint = '';
  export let className = 'btn-ghost btn-sm';
  export let iconOnly = false;
  export let size = 16;

  let supported = false;
  let status: 'idle' | 'copied' | 'error' = 'idle';
  let timeout: ReturnType<typeof setTimeout>;

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
    clearTimeout(timeout);
    try {
      await navigator.share(payload());
      status = 'copied';
      timeout = setTimeout(() => { status = 'idle'; }, 1500);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      status = 'error';
      timeout = setTimeout(() => { status = 'idle'; }, 1500);
    }
  }

  $: iconSize = (size <= 15 ? 16 : 20) as 16 | 20;
  $: doneText = copiedLabel || label;
  $: failText = errorLabel || label;
  $: reserveCh = Math.max(label.length, doneText.length, failText.length, 1);
  $: activeLabel = status === 'copied' ? doneText : status === 'error' ? failText : label;
</script>

{#if supported}
  <button
    type="button"
    class="{className} btn-feedback"
    class:btn-icon={iconOnly}
    class:btn-feedback--done={status === 'copied'}
    class:btn-feedback--error={status === 'error'}
    on:click={share}
    disabled={!url}
    aria-label={iconOnly ? activeLabel : undefined}
    title={iconOnly ? activeLabel : undefined}
  >
    <span class="btn-feedback__icon inline-grid shrink-0" aria-hidden="true">
      <span class="btn-feedback__layer btn-feedback__layer--idle col-start-1 row-start-1" class:opacity-0={status !== 'idle'}><Icon name="share-2" size={iconSize} /></span>
      <span class="btn-feedback__layer btn-feedback__layer--done col-start-1 row-start-1" class:opacity-0={status !== 'copied'}><Icon name="check" size={iconSize} /></span>
      <span class="btn-feedback__layer btn-feedback__layer--error col-start-1 row-start-1" class:opacity-0={status !== 'error'}><Icon name="x" size={iconSize} /></span>
    </span>
    {#if !iconOnly}
      <span class="btn-feedback__label inline-grid justify-items-start" style="min-inline-size: {reserveCh}ch" role="status">
        <span class="btn-feedback__layer btn-feedback__layer--idle col-start-1 row-start-1" class:opacity-0={status !== 'idle'} aria-hidden={status !== 'idle'}>{label}</span>
        <span class="btn-feedback__layer btn-feedback__layer--done col-start-1 row-start-1" class:opacity-0={status !== 'copied'} aria-hidden={status !== 'copied'}>{doneText}</span>
        <span class="btn-feedback__layer btn-feedback__layer--error col-start-1 row-start-1" class:opacity-0={status !== 'error'} aria-hidden={status !== 'error'}>{failText}</span>
      </span>
    {:else}
      <span class="sr-only" role="status">{status === 'idle' ? '' : activeLabel}</span>
    {/if}
  </button>
  {#if hint}
    <p class="hint">{hint}</p>
  {/if}
{/if}
