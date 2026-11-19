<script lang="ts">
  import { onMount } from 'svelte';
  import { RETENTIONS, latestUploadUnlock, type Retention } from '../../lib/retention';
  import { t } from '../../lib/t';

  export let dict: Record<string, string>;
  export let mode: 'link' | 'ghost' | 'local' = 'link';
  export let retention: Retention;
  export let burn = false;
  /** Small enough to travel inside the link unless it has to burn after reading. */
  export let short = false;
  /** The server has no room for uploads, so nothing can be stored to burn. */
  export let burnUnavailable = false;
  /** Timelock + reminder copy: treat unlock as a dead-man's release window. */
  export let deadMan = false;
  /** datetime-local value, empty for no time lock. */
  export let unlockAt = '';
  /** Retention the upload will really get once the unlock time is taken into account; null when none is long enough. */
  export let effectiveRetention: Retention | null = retention;

  $: if (!unlockAt) deadMan = false;

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
  <div class="grid gap-x-4 gap-y-2 sm:grid-cols-2 sm:items-end">
    {#if upload}
      <div class="field">
        <label class="label" for="ue-retention">{t(dict, 'tools.ultimateEncrypt.options.retention')}</label>
        <select id="ue-retention" class="input" bind:value={retention}>
          {#each RETENTIONS as option}
            <option value={option}>{t(dict, `tools.ultimateEncrypt.options.retention${option}`)}</option>
          {/each}
        </select>
      </div>
    {/if}
    <label class="check" class:opacity-60={burnUnavailable}>
      <input type="checkbox" bind:checked={burn} aria-describedby="ue-burn-hint" disabled={burnUnavailable} />
      <span>{t(dict, 'tools.ultimateEncrypt.options.burn')}</span>
    </label>
  </div>
  <div id="ue-burn-hint" class="-mt-2 grid gap-1">
    <p class="hint">{t(dict, burnUnavailable ? 'tools.ultimateEncrypt.options.burnUnavailable' : 'tools.ultimateEncrypt.options.burnHint')}</p>
    {#if short}
      <p class="hint">{t(dict, burn ? 'tools.ultimateEncrypt.options.burnStoredHint' : 'tools.ultimateEncrypt.options.inlineHint')}</p>
    {/if}
  </div>

  <div class="field">
    <label class="label" for="ue-unlock">{t(dict, 'tools.ultimateEncrypt.options.unlockAfter')}</label>
    <input id="ue-unlock" type="datetime-local" class="input" bind:value={unlockAt} {min} max={upload ? max : undefined} aria-describedby={tooFar ? 'ue-unlock-hint ue-unlock-error' : 'ue-unlock-hint'} aria-invalid={tooFar ? 'true' : undefined} />
    <p id="ue-unlock-hint" class="hint">{t(dict, 'tools.ultimateEncrypt.options.unlockHint')}</p>
    {#if raised && effectiveRetention}
      <p class="status" role="status">{t(dict, 'tools.ultimateEncrypt.options.retentionRaised').replace('{retention}', t(dict, `tools.ultimateEncrypt.options.retention${effectiveRetention}`))}</p>
    {:else if tooFar}
      <p id="ue-unlock-error" class="status status--error" role="alert">{t(dict, 'tools.ultimateEncrypt.options.unlockTooFar')}</p>
    {/if}
  </div>

  <div class="grid gap-1">
    <label class="check" class:opacity-60={!unlockAt}>
      <input type="checkbox" bind:checked={deadMan} aria-describedby="ue-dead-man-hint" disabled={!unlockAt} />
      <span>{t(dict, 'tools.ultimateEncrypt.options.deadMan')}</span>
    </label>
    <p id="ue-dead-man-hint" class="hint">{t(dict, 'tools.ultimateEncrypt.options.deadManHint')}</p>
  </div>
{/if}
