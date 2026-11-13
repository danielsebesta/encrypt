<script lang="ts">
  import Icon from './Icon.svelte';

  export let text = '';
  export let label = '';
  export let copiedLabel = '';
  export let className = '';
  export let variant: 'ghost' | 'primary' = 'ghost';

  let copied = false;
  let timeout: ReturnType<typeof setTimeout>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      clearTimeout(timeout);
      timeout = setTimeout(() => { copied = false; }, 2000);
    } catch {}
  }

  $: baseClass = variant === 'primary' ? 'btn' : 'btn-ghost btn-sm';
</script>

<button type="button" class="{baseClass} {className}" on:click={copy} disabled={!text}>
  {#if copied}
    <Icon name="check" />
  {:else}
    <Icon name="copy" />
  {/if}
  <span role="status">{copied ? copiedLabel || label : label}</span>
</button>
