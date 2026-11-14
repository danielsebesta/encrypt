<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../lib/t';
  import { BG_MODES, readBgMode, writeBgMode, type BgMode } from '../lib/bgMode';

  export let dict: Record<string, string>;

  let mode: BgMode = 'estuary';
  onMount(() => { mode = readBgMode(); });

  function pick(next: BgMode) {
    mode = next;
    writeBgMode(next);
  }
</script>

<div class="bg-switch" role="group" aria-label={t(dict, 'home.background.label')}>
  {#each BG_MODES as item}
    <button type="button" class="bg-switch__pill" aria-pressed={mode === item} on:click={() => pick(item)}>
      {t(dict, `home.background.${item}`)}
    </button>
  {/each}
</div>

<style>
  .bg-switch { display: flex; width: fit-content; margin-top: 1.5rem; gap: 0.25rem; padding: 0.25rem; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--bg); }
  .bg-switch__pill { padding: 0.25rem 0.75rem; border-radius: var(--radius-sm); border: 0; background: transparent; color: var(--muted); font-size: 0.8125rem; transition: background var(--duration-base), color var(--duration-base); }
  .bg-switch__pill:hover { color: var(--text); }
  .bg-switch__pill[aria-pressed='true'] { background: var(--surface-2); color: var(--text); }
  .bg-switch__pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
