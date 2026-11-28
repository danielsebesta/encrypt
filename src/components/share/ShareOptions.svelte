<script lang="ts">
  import { onMount } from 'svelte';
  import { RETENTIONS, latestUploadUnlock, type Retention } from '../../lib/retention';
  import { t } from '../../lib/t';
  import Field from '../ui/Field.svelte';

  export let dict: Record<string, string>;
  export let mode: 'link' | 'upload' | 'local' = 'link';
  export let retention: Retention;
  export let burn = false;
  export let keyInLink = false;
  export let short = false;
  export let burnUnavailable = false;
  export let deadMan = false;
  export let unlockAt = '';
  export let effectiveRetention: Retention | null = retention;
  export let unlockError = '';
  export let recipients = false;

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

  $: upload = mode === 'upload';
  $: raised = upload && !!unlockAt && !!effectiveRetention && effectiveRetention !== retention;
  $: tooFar = upload && !!unlockAt && !effectiveRetention;
</script>

{#if mode !== 'local'}
  <div class="grid gap-6">
    {#if upload}
      <Field label={t(dict, 'tools.shareForm.options.retention')} id="share-retention" class="sm:max-w-xs">
        {#snippet children(control)}
          <select class="input" bind:value={retention} {...control}>
            {#each RETENTIONS as option}
              <option value={option}>{t(dict, `tools.shareForm.options.retention${option}`)}</option>
            {/each}
          </select>
        {/snippet}
      </Field>
    {/if}

    {#if recipients}
      <p class="hint">{t(dict, 'tools.shareForm.options.recipientsHint')}</p>
    {:else}
    <div class="grid">
      <label class="check">
        <input type="checkbox" bind:checked={keyInLink} aria-describedby="share-key-hint" />
        <span>{t(dict, 'tools.shareForm.options.keyInLink')}</span>
      </label>
      <p id="share-key-hint" class="hint -mt-1.5">{t(dict, 'tools.shareForm.options.keyInLinkHint')}</p>
    </div>

    <div class="grid">
      <label class="check">
        <input type="checkbox" bind:checked={burn} aria-describedby="share-burn-hint" disabled={burnUnavailable} />
        <span>{t(dict, 'tools.shareForm.options.burn')}</span>
      </label>
      <div id="share-burn-hint" class="-mt-1.5 grid gap-1">
        <p class="hint">{t(dict, burnUnavailable ? 'tools.shareForm.options.burnUnavailable' : 'tools.shareForm.options.burnHint')}</p>
        {#if short}
          <p class="hint">{t(dict, burn ? 'tools.shareForm.options.burnStoredHint' : 'tools.shareForm.options.inlineHint')}</p>
        {/if}
      </div>
    </div>

    <div class="grid gap-1.5">
      <Field
        label={t(dict, 'tools.shareForm.options.unlockAfter')}
        hint={t(dict, 'tools.shareForm.options.unlockHint')}
        error={tooFar ? t(dict, 'tools.shareForm.options.unlockTooFar') : unlockError}
        id="share-unlock"
      >
        {#snippet children(control)}
          <input type="datetime-local" class="input sm:max-w-xs" bind:value={unlockAt} {min} max={upload ? max : undefined} {...control} />
        {/snippet}
      </Field>
      {#if raised && effectiveRetention}
        <p class="status" role="status">{t(dict, 'tools.shareForm.options.retentionRaised').replace('{retention}', t(dict, `tools.shareForm.options.retention${effectiveRetention}`))}</p>
      {/if}
    </div>

    <div class="grid">
      <label class="check">
        <input type="checkbox" bind:checked={deadMan} aria-describedby="share-dead-man-hint" disabled={!unlockAt} />
        <span>{t(dict, 'tools.shareForm.options.deadMan')}</span>
      </label>
      <p id="share-dead-man-hint" class="hint -mt-1.5">{t(dict, 'tools.shareForm.options.deadManHint')}</p>
    </div>
    {/if}
  </div>
{/if}
