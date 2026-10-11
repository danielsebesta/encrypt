<script lang="ts">
  import { generateUUID, generateULID } from '../../lib/ids';
  import { onMount } from 'svelte';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let uuidResult = '';
  let ulidResult = '';

  function refresh() {
    uuidResult = generateUUID();
    ulidResult = generateULID();
  }

  onMount(refresh);
</script>

<div class="stack">
  <div class="field">
    <div class="output-head">
      <span class="label" id="uuid-label">{t(dict, 'tools.uuidUlid.uuidV4')}</span>
      <div class="flex items-center gap-1">
        <button type="button" class="btn-ghost btn-sm btn-icon" aria-label={t(dict, 'tools.uuidUlid.refreshUuid')} on:click={() => uuidResult = generateUUID()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
        </button>
        <CopyButton text={uuidResult} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
      </div>
    </div>
    <output class="output" aria-labelledby="uuid-label" aria-live="polite">{uuidResult}</output>
  </div>

  <div class="field">
    <div class="output-head">
      <span class="label" id="ulid-label">{t(dict, 'tools.uuidUlid.ulidFull')}</span>
      <div class="flex items-center gap-1">
        <button type="button" class="btn-ghost btn-sm btn-icon" aria-label={t(dict, 'tools.uuidUlid.refreshUlid')} on:click={() => ulidResult = generateULID()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
        </button>
        <CopyButton text={ulidResult} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
      </div>
    </div>
    <output class="output" aria-labelledby="ulid-label" aria-live="polite">{ulidResult}</output>
  </div>

  <button type="button" class="btn w-full" on:click={refresh}>{t(dict, 'tools.uuidUlid.generateNew')}</button>
</div>
