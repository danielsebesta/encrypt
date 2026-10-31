<script lang="ts">
  import { RETENTIONS, type Retention } from '../../lib/retention';
  import { t } from '../../lib/t';

  export let dict: Record<string, string>;
  export let upload = false;
  export let retention: Retention;
  export let burn = false;
</script>

{#if upload}
  <div class="grid gap-x-4 gap-y-2 sm:grid-cols-2 sm:items-end">
    <div class="field">
      <label class="label" for="ue-retention">{t(dict, 'tools.ultimateEncrypt.options.retention')}</label>
      <select id="ue-retention" class="input" bind:value={retention}>
        {#each RETENTIONS as option}
          <option value={option}>{t(dict, `tools.ultimateEncrypt.options.retention${option}`)}</option>
        {/each}
      </select>
    </div>
    <label class="check">
      <input type="checkbox" bind:checked={burn} aria-describedby="ue-burn-hint" />
      <span>{t(dict, 'tools.ultimateEncrypt.options.burn')}</span>
    </label>
  </div>
  <p id="ue-burn-hint" class="hint">{t(dict, 'tools.ultimateEncrypt.options.burnHint')}</p>
{:else}
  <p class="hint">{t(dict, 'tools.ultimateEncrypt.options.inlineHint')}</p>
{/if}
