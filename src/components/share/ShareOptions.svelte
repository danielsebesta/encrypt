<script lang="ts">
  import { onMount } from 'svelte';
  import { RETENTIONS, latestUploadUnlock, type Retention } from '../../lib/retention';
  import { t } from '../../lib/t';
  import Field from '../ui/Field.svelte';

  export let dict: Record<string, string>;
  export let mode: 'link' | 'ghost' | 'local' = 'link';
  export let retention: Retention;
  export let burn = false;
  export let keyInLink = false;
  export let short = false;
  export let burnUnavailable = false;
  export let deadMan = false;
  export let unlockAt = '';
  export let effectiveRetention: Retention | null = retention;
  export let unlockError = '';

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
  $: raised = upload && !!unlockAt && !!effectiveRetention && effectiveRetention !== retention;
  $: tooFar = upload && !!unlockAt && !effectiveRetention;
</script>

{#if mode !== 'local'}
  <div class="grid gap-6">
    {#if upload}
      <Field label={t(dict, 'tools.ultimateEncrypt.options.retention')} id="ue-retention" class="sm:max-w-xs">
        {#snippet children(control)}
          <select class="input" bind:value={retention} {...control}>
            {#each RETENTIONS as option}
              <option value={option}>{t(dict, `tools.ultimateEncrypt.options.retention${option}`)}</option>
            {/each}
          </select>
        {/snippet}
      </Field>
    {/if}

    <div class="grid">
      <label class="check">
        <input type="checkbox" bind:checked={keyInLink} aria-describedby="ue-key-hint" />
        <span>{t(dict, 'tools.ultimateEncrypt.options.keyInLink')}</span>
      </label>
      <p id="ue-key-hint" class="hint -mt-1.5">{t(dict, 'tools.ultimateEncrypt.options.keyInLinkHint')}</p>
    </div>

    <div class="grid">
      <label class="check">
        <input type="checkbox" bind:checked={burn} aria-describedby="ue-burn-hint" disabled={burnUnavailable} />
        <span>{t(dict, 'tools.ultimateEncrypt.options.burn')}</span>
      </label>
      <div id="ue-burn-hint" class="-mt-1.5 grid gap-1">
        <p class="hint">{t(dict, burnUnavailable ? 'tools.ultimateEncrypt.options.burnUnavailable' : 'tools.ultimateEncrypt.options.burnHint')}</p>
        {#if short}
          <p class="hint">{t(dict, burn ? 'tools.ultimateEncrypt.options.burnStoredHint' : 'tools.ultimateEncrypt.options.inlineHint')}</p>
        {/if}
      </div>
    </div>

    <div class="grid gap-1.5">
      <Field
        label={t(dict, 'tools.ultimateEncrypt.options.unlockAfter')}
        hint={t(dict, 'tools.ultimateEncrypt.options.unlockHint')}
        error={tooFar ? t(dict, 'tools.ultimateEncrypt.options.unlockTooFar') : unlockError}
        id="ue-unlock"
      >
        {#snippet children(control)}
          <input type="datetime-local" class="input sm:max-w-xs" bind:value={unlockAt} {min} max={upload ? max : undefined} {...control} />
        {/snippet}
      </Field>
      {#if raised && effectiveRetention}
        <p class="status" role="status">{t(dict, 'tools.ultimateEncrypt.options.retentionRaised').replace('{retention}', t(dict, `tools.ultimateEncrypt.options.retention${effectiveRetention}`))}</p>
      {/if}
    </div>

    <div class="grid">
      <label class="check">
        <input type="checkbox" bind:checked={deadMan} aria-describedby="ue-dead-man-hint" disabled={!unlockAt} />
        <span>{t(dict, 'tools.ultimateEncrypt.options.deadMan')}</span>
      </label>
      <p id="ue-dead-man-hint" class="hint -mt-1.5">{t(dict, 'tools.ultimateEncrypt.options.deadManHint')}</p>
    </div>
  </div>
{/if}
