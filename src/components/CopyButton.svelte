<script lang="ts">
  import { LUCIDE } from '../lib/lucideIcons';

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
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['check']}</svg>
  {:else}
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['copy']}</svg>
  {/if}
  <span role="status">{copied ? copiedLabel || label : label}</span>
</button>
