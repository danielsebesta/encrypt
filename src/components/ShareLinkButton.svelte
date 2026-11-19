<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { buttonClass, type ButtonSize, type ButtonVariant } from './ui/button';

  export let url = '';
  export let title = '';
  export let text = '';
  export let label = '';
  export let doneLabel = '';
  export let errorLabel = '';
  export let variant: ButtonVariant = 'secondary';
  export let size: ButtonSize = 'md';
  export let block = false;
  export let iconOnly = false;

  let supported = false;
  let status: 'idle' | 'done' | 'error' = 'idle';
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
      supported = !navigator.canShare || navigator.canShare(payload(url || location.href));
    } catch {
      supported = false;
    }
  });

  async function share() {
    if (!url || typeof navigator.share !== 'function') return;
    clearTimeout(timeout);
    try {
      await navigator.share(payload());
      status = 'done';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      status = 'error';
    }
    timeout = setTimeout(() => { status = 'idle'; }, 1500);
  }

  $: doneText = doneLabel || label;
  $: failText = errorLabel || label;
</script>

{#if supported}
  <button
    type="button"
    class="{buttonClass({ variant, size, block, icon: iconOnly })} btn-feedback"
    class:btn-feedback--done={status === 'done'}
    class:btn-feedback--error={status === 'error'}
    on:click={share}
    disabled={!url}
    aria-label={iconOnly ? label : undefined}
    title={iconOnly ? label : undefined}
  >
    <span class="btn-feedback__icon inline-grid shrink-0" aria-hidden="true">
      <span class="btn-feedback__layer col-start-1 row-start-1" class:opacity-0={status !== 'idle'}><Icon name="share-2" /></span>
      <span class="btn-feedback__layer col-start-1 row-start-1" class:opacity-0={status !== 'done'}><Icon name="check" /></span>
      <span class="btn-feedback__layer col-start-1 row-start-1" class:opacity-0={status !== 'error'}><Icon name="x" /></span>
    </span>
    {#if !iconOnly}
      <span class="inline-grid justify-items-start">
        <span class="btn-feedback__layer col-start-1 row-start-1" class:opacity-0={status !== 'idle'} aria-hidden={status !== 'idle'}>{label}</span>
        <span class="btn-feedback__layer col-start-1 row-start-1" class:opacity-0={status !== 'done'} aria-hidden={status !== 'done'}>{doneText}</span>
        <span class="btn-feedback__layer col-start-1 row-start-1" class:opacity-0={status !== 'error'} aria-hidden={status !== 'error'}>{failText}</span>
      </span>
    {/if}
  </button>
  <span class="sr-only" role="status">{status === 'done' ? doneText : status === 'error' ? failText : ''}</span>
{/if}
