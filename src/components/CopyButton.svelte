<script lang="ts">
  import Icon from './Icon.svelte';
  import { copyText } from '../lib/clipboard';
  import { buttonClass, type ButtonSize, type ButtonVariant } from './ui/button';

  export let text = '';
  export let label = '';
  export let copiedLabel = '';
  export let errorLabel = '';
  export let variant: ButtonVariant = 'ghost';
  export let size: ButtonSize | undefined = undefined;
  export let block = false;

  let status: 'idle' | 'copied' | 'error' = 'idle';
  let timeout: ReturnType<typeof setTimeout>;

  async function copy() {
    if (!text) return;
    clearTimeout(timeout);
    const ok = await copyText(text);
    status = ok ? 'copied' : 'error';
    timeout = setTimeout(() => { status = 'idle'; }, 1500);
  }

  $: resolvedSize = size ?? (variant === 'ghost' ? 'sm' : 'md');
  $: doneText = copiedLabel || label;
  $: failText = errorLabel || label;
  $: labels = [
    { state: 'idle', text: label },
    { state: 'copied', text: doneText },
    { state: 'error', text: failText },
  ] as const;
</script>

<button
  type="button"
  class="{buttonClass({ variant, size: resolvedSize, block })} btn-feedback"
  class:btn-feedback--done={status === 'copied'}
  class:btn-feedback--error={status === 'error'}
  on:click={copy}
  disabled={!text}
>
  <span class="btn-feedback__icon inline-grid shrink-0" aria-hidden="true">
    <span class="btn-feedback__layer col-start-1 row-start-1" class:opacity-0={status !== 'idle'}><Icon name="copy" /></span>
    <span class="btn-feedback__layer col-start-1 row-start-1" class:opacity-0={status !== 'copied'}><Icon name="check" /></span>
    <span class="btn-feedback__layer col-start-1 row-start-1" class:opacity-0={status !== 'error'}><Icon name="x" /></span>
  </span>
  {#if variant === 'ghost'}
    <span>{labels.find((l) => l.state === status)?.text}</span>
  {:else}
    <span class="inline-grid justify-items-start">
      {#each labels as l (l.state)}
        <span class="btn-feedback__layer col-start-1 row-start-1" class:opacity-0={status !== l.state} aria-hidden={status !== l.state}>{l.text}</span>
      {/each}
    </span>
  {/if}
</button>
<span class="sr-only" role="status">{status === 'copied' ? doneText : status === 'error' ? failText : ''}</span>
