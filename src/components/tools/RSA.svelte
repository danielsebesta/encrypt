<script lang="ts">
  import { generateRSAKeyPair } from '../../lib/rsaKeys';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let bits = 2048;
  let isGenerating = false;
  let error = '';
  let keyPair: { publicKey: string, privateKey: string } | null = null;

  async function generate() {
    error = '';
    isGenerating = true;
    try {
      keyPair = await generateRSAKeyPair(bits);
    } catch {
      error = t(dict, 'tools.rsa.failedToGenerate');
    } finally {
      isGenerating = false;
    }
  }
</script>

<div class="stack">
  <div class="field">
    <label class="label" for="rsa-bits">{t(dict, 'tools.rsa.keyBitLength')}</label>
    <select id="rsa-bits" bind:value={bits} class="input">
      <option value={1024}>{t(dict, 'tools.rsa.bit1024')}</option>
      <option value={2048}>{t(dict, 'tools.rsa.bit2048')}</option>
      <option value={4096}>{t(dict, 'tools.rsa.bit4096')}</option>
    </select>
  </div>

  <button type="button" class="btn w-full" on:click={generate} disabled={isGenerating}>
    {isGenerating ? t(dict, 'tools.rsa.generatingPrimes') : t(dict, 'tools.rsa.generateBtn')}
  </button>

  {#if error}
    <p class="status status--error" role="alert">{error}</p>
  {/if}
  {#if keyPair}
    <div class="stack" role="status">
      <div class="field">
        <div class="output-head">
          <span class="label" id="rsa-pub-label">{t(dict, 'tools.rsa.publicKey')}</span>
          <CopyButton text={keyPair.publicKey} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output class="output output--scroll" aria-labelledby="rsa-pub-label">{keyPair.publicKey}</output>
      </div>
      <div class="field">
        <div class="output-head">
          <span class="label" id="rsa-priv-label">{t(dict, 'tools.rsa.privateKey')}</span>
          <CopyButton text={keyPair.privateKey} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output class="output output--secret output--scroll" aria-labelledby="rsa-priv-label">{keyPair.privateKey}</output>
        <p class="hint">{t(dict, 'common.secretHint')}</p>
      </div>
    </div>
  {/if}
</div>
