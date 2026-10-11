<script lang="ts">
  import { decodeJWT } from '../../lib/jwt';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let input = '';
  let result: { header: unknown; payload: unknown } | null = null;
  let error = '';

  function handleInput() {
    error = '';
    if (!input.trim()) {
      result = null;
      return;
    }
    try {
      result = decodeJWT(input.trim());
    } catch {
      result = null;
      error = t(dict, 'tools.jwt.invalidJwt');
    }
  }

  $: headerJson = result ? JSON.stringify(result.header, null, 2) : '';
  $: payloadJson = result ? JSON.stringify(result.payload, null, 2) : '';
</script>

<div class="stack">
  <div class="field">
    <label class="label" for="jwt-input">{t(dict, 'tools.jwt.encodedToken')}</label>
    <textarea id="jwt-input" bind:value={input} on:input={handleInput} placeholder={t(dict, 'tools.jwt.placeholder')} class="input input--mono" spellcheck="false" autocomplete="off" autocapitalize="off" aria-invalid={error ? 'true' : undefined}></textarea>
  </div>

  {#if error}
    <p class="status status--error" role="alert">{error}</p>
  {/if}

  {#if result}
    <div class="stack" role="status">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="field">
          <div class="output-head">
            <span class="label" id="jwt-header-label">{t(dict, 'tools.jwt.header')}</span>
            <CopyButton text={headerJson} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
          </div>
          <pre class="output" aria-labelledby="jwt-header-label">{headerJson}</pre>
        </div>
        <div class="field">
          <div class="output-head">
            <span class="label" id="jwt-payload-label">{t(dict, 'tools.jwt.payload')}</span>
            <CopyButton text={payloadJson} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
          </div>
          <pre class="output" aria-labelledby="jwt-payload-label">{payloadJson}</pre>
        </div>
      </div>
      <p class="status">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <span><strong>{t(dict, 'tools.jwt.signatureStatus')}:</strong> {t(dict, 'tools.jwt.decodedLocally')}</span>
      </p>
    </div>
  {/if}
</div>
