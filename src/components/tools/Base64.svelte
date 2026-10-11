<script lang="ts">
  import { base64Encode, base64Decode } from '../../lib/base64';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let input = '';
  let output = '';
  let error = '';
  let mode: 'encode' | 'decode' = 'encode';

  function handleProcess() {
    error = '';
    if (!input) {
      output = '';
      return;
    }
    try {
      output = mode === 'encode' ? base64Encode(input) : base64Decode(input);
    } catch {
      output = '';
      error = mode === 'encode' ? t(dict, 'tools.base64.errorInvalidEncode') : t(dict, 'tools.base64.errorInvalid');
    }
  }

  $: if (input || mode) handleProcess();
</script>

<div class="stack">
  <div class="tabs" role="tablist" aria-label={t(dict, 'tools.base64.h1')}>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'encode'} aria-controls="base64-panel" on:click={() => mode = 'encode'}>{t(dict, 'tools.base64.encode')}</button>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'decode'} aria-controls="base64-panel" on:click={() => mode = 'decode'}>{t(dict, 'tools.base64.decode')}</button>
  </div>

  <div id="base64-panel" role="tabpanel" class="stack">
    <div class="field">
      <label class="label" for="base64-input">{t(dict, 'tools.base64.inputText')}</label>
      <textarea id="base64-input" bind:value={input} placeholder={mode === 'encode' ? t(dict, 'tools.base64.encodePlaceholder') : t(dict, 'tools.base64.decodePlaceholder')} class="input input--mono" spellcheck="false" autocapitalize="off" aria-invalid={error ? 'true' : undefined}></textarea>
    </div>

    {#if error}
      <p class="status status--error" role="alert">{error}</p>
    {/if}

    <div class="field">
      <div class="output-head">
        <span class="label" id="base64-out-label">{t(dict, 'tools.base64.outputResult')}</span>
        <CopyButton text={output} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
      </div>
      <output class="output min-h-32" aria-labelledby="base64-out-label" aria-live="polite">{output}</output>
    </div>
  </div>
</div>
