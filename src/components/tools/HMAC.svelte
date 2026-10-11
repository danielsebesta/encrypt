<script lang="ts">
  import { hmac } from '../../lib/hmac';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let message = '';
  let secret = '';
  let result = '';
  let error = '';

  async function generate() {
    error = '';
    if (!message || !secret) {
      error = t(dict, 'tools.hmac.errorBoth');
      return;
    }
    result = await hmac(message, secret);
  }
</script>

<div class="stack">
  <div class="field">
    <label class="label" for="hmac-message">{t(dict, 'tools.hmac.messageData')}</label>
    <textarea id="hmac-message" bind:value={message} placeholder={t(dict, 'tools.hmac.payloadPlaceholder')} class="input"></textarea>
  </div>
  <div class="field">
    <label class="label" for="hmac-secret">{t(dict, 'tools.hmac.secretKey')}</label>
    <input id="hmac-secret" bind:value={secret} type="password" placeholder={t(dict, 'tools.hmac.secretPlaceholder')} class="input" autocomplete="off" />
  </div>

  <button type="button" class="btn w-full" on:click={generate}>{t(dict, 'tools.hmac.generateBtn')}</button>

  {#if error}
    <p class="status status--error" role="alert">{error}</p>
  {/if}
  {#if result}
    <div class="field">
      <div class="output-head">
        <span class="label" id="hmac-out-label">{t(dict, 'tools.hmac.macSignature')}</span>
        <CopyButton text={result} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
      </div>
      <output class="output output--ok" aria-labelledby="hmac-out-label" aria-live="polite">{result}</output>
    </div>
  {/if}
</div>
