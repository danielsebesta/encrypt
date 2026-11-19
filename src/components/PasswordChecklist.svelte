<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../lib/t';

  export let id: string;
  export let label: string;
  export let rules: { ok: boolean; label: string }[];
  export let dict: Record<string, string> | undefined = undefined;
  export let invalid = false;
</script>

<ul {id} class="mt-1 grid gap-1 text-sm leading-snug text-muted" aria-label={label}>
  {#each rules as rule}
    <li class="flex items-start gap-2" class:text-text={rule.ok} class:text-danger={invalid && !rule.ok}>
      <span class="mt-px flex h-4 shrink-0 items-center" class:text-accent={rule.ok}>
        <Icon name={rule.ok ? 'check' : 'circle'} />
      </span>
      <span>{rule.label}</span>
      {#if dict}
        <span class="sr-only">{rule.ok ? t(dict, 'common.rule.met') : t(dict, 'common.rule.unmet')}</span>
      {/if}
    </li>
  {/each}
</ul>
