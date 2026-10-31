<script lang="ts">
  import { onMount } from 'svelte';
  import { RETENTIONS, latestUploadUnlock, type Retention } from '../../lib/retention';
  import { t } from '../../lib/t';

  export let dict: Record<string, string>;
  export let mode: 'link' | 'ghost' | 'local' = 'link';
  export let retention: Retention;
  export let burn = false;
  /** datetime-local value, empty for no time lock. */
  export let unlockAt = '';
  /** Retention the upload will really get once the unlock time is taken into account; null when none is long enough. */
  export let effectiveRetention: Retention | null = retention;

  const localInput = (ms: number) => {
    const d = new Date(ms);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  let min = '';
  let max = '';
  onMount(() => {
    min = localInput(Date.now() + 60_000);
    max = localInput(latestUploadUnlock());
  });

  $: upload = mode === 'ghost';
  $: raised = upload && unlockAt && effectiveRetention && effectiveRetention !== retention;
  $: tooFar = upload && unlockAt && !effectiveRetention;
</script>

{#if mode !== 'local'}
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

  <div class="field">
    <label class="label" for="ue-unlock">{t(dict, 'tools.ultimateEncrypt.options.unlockAfter')}</label>
    <input id="ue-unlock" type="datetime-local" class="input" bind:value={unlockAt} {min} max={upload ? max : undefined} aria-describedby="ue-unlock-hint" aria-invalid={tooFar ? 'true' : undefined} />
    <p id="ue-unlock-hint" class="hint">{t(dict, 'tools.ultimateEncrypt.options.unlockHint')}</p>
    {#if raised && effectiveRetention}
      <p class="status" role="status">{t(dict, 'tools.ultimateEncrypt.options.retentionRaised').replace('{retention}', t(dict, `tools.ultimateEncrypt.options.retention${effectiveRetention}`))}</p>
    {:else if tooFar}
      <p class="status status--error" role="alert">{t(dict, 'tools.ultimateEncrypt.options.unlockTooFar')}</p>
    {/if}
  </div>
{/if}
