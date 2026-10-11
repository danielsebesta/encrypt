<script lang="ts">
  export let text = '';
  export let label = '';
  export let copiedLabel = '';
  export let className = '';

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
</script>

<button type="button" class="btn-ghost btn-sm {className}" on:click={copy} disabled={!text}>
  {#if copied}
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
  {:else}
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
  {/if}
  <span role="status">{copied ? copiedLabel || label : label}</span>
</button>
