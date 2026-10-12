<script lang="ts">
  export let id: string;
  export let label: string;
  export let rules: { ok: boolean; label: string }[];
</script>

<ul {id} class="pw-rules" aria-label={label}>
  {#each rules as rule}
    <li class="pw-rules__item" class:pw-rules__item--ok={rule.ok}>
      {#if rule.ok}
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>
      {/if}
      <span>{rule.label}</span>
    </li>
  {/each}
</ul>

<style>
  .pw-rules {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.25rem;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .pw-rules__item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .pw-rules__item svg {
    flex: none;
  }
  .pw-rules__item--ok {
    color: var(--text);
  }
  .pw-rules__item--ok svg {
    color: var(--accent);
  }
</style>
