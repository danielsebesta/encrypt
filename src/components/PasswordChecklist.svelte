<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../lib/t';

  export let id: string;
  export let label: string;
  export let rules: { ok: boolean; label: string }[];
  export let dict: Record<string, string> | undefined = undefined;
  export let invalid = false;
</script>

<ul {id} class="pw-rules" aria-label={label}>
  {#each rules as rule}
    <li class="pw-rules__item" class:pw-rules__item--ok={rule.ok} class:pw-rules__item--bad={invalid && !rule.ok}>
      {#if rule.ok}
        <Icon name="check" />
      {:else}
        <Icon name="circle" />
      {/if}
      <span>{rule.label}</span>
      {#if dict}
        <span class="sr-only">{rule.ok ? t(dict, 'common.rule.met') : t(dict, 'common.rule.unmet')}</span>
      {/if}
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
  .pw-rules__item--bad {
    color: var(--danger);
  }
  .pw-rules__item--ok svg {
    color: var(--accent);
  }
</style>
