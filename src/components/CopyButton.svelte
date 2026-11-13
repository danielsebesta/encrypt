<script lang="ts">
  import Icon from './Icon.svelte';
  import { copyText } from '../lib/clipboard';

  export let text = '';
  export let label = '';
  export let copiedLabel = '';
  export let errorLabel = '';
  export let className = '';
  export let variant: 'ghost' | 'primary' = 'ghost';

  let status: 'idle' | 'copied' | 'error' = 'idle';
  let timeout: ReturnType<typeof setTimeout>;

  async function copy() {
    if (!text) return;
    clearTimeout(timeout);
    const ok = await copyText(text);
    status = ok ? 'copied' : 'error';
    timeout = setTimeout(() => { status = 'idle'; }, 1500);
  }

  $: baseClass = variant === 'primary' ? 'btn' : 'btn-ghost btn-sm';
  $: doneText = copiedLabel || label;
  $: failText = errorLabel || label;
  $: reserveCh = Math.max(label.length, doneText.length, failText.length, 1);
</script>

<button
  type="button"
  class="{baseClass} btn-feedback {className}"
  class:btn-feedback--done={status === 'copied'}
  class:btn-feedback--error={status === 'error'}
  on:click={copy}
  disabled={!text}
>
  <span class="btn-feedback__icon inline-grid shrink-0" aria-hidden="true">
    <span class="btn-feedback__layer btn-feedback__layer--idle col-start-1 row-start-1" class:opacity-0={status !== 'idle'}><Icon name="copy" /></span>
    <span class="btn-feedback__layer btn-feedback__layer--done col-start-1 row-start-1" class:opacity-0={status !== 'copied'}><Icon name="check" /></span>
    <span class="btn-feedback__layer btn-feedback__layer--error col-start-1 row-start-1" class:opacity-0={status !== 'error'}><Icon name="x" /></span>
  </span>
  <span class="btn-feedback__label inline-grid justify-items-start" style="min-inline-size: {reserveCh}ch" role="status">
    <span class="btn-feedback__layer btn-feedback__layer--idle col-start-1 row-start-1" class:opacity-0={status !== 'idle'} aria-hidden={status !== 'idle'}>{label}</span>
    <span class="btn-feedback__layer btn-feedback__layer--done col-start-1 row-start-1" class:opacity-0={status !== 'copied'} aria-hidden={status !== 'copied'}>{doneText}</span>
    <span class="btn-feedback__layer btn-feedback__layer--error col-start-1 row-start-1" class:opacity-0={status !== 'error'} aria-hidden={status !== 'error'}>{failText}</span>
  </span>
</button>
