<script lang="ts">
  import { generateSSHKeyPair } from '../../lib/rsaKeys';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let bits = 4096;
  let isGenerating = false;
  let error = '';
  let keyPair: { publicKey: string; privateKey: string } | null = null;

  async function generate() {
    error = '';
    isGenerating = true;
    try {
      keyPair = await generateSSHKeyPair(bits);
    } catch {
      keyPair = null;
      error = t(dict, 'tools.sshKeys.failedToGenerate');
    } finally {
      isGenerating = false;
    }
  }
</script>

<div class="stack">
  <div class="field">
    <label class="label" for="ssh-bits">{t(dict, 'tools.sshKeys.keyBitLength')}</label>
    <select id="ssh-bits" bind:value={bits} class="input">
      <option value={2048}>{t(dict, 'tools.sshKeys.bit2048')}</option>
      <option value={4096}>{t(dict, 'tools.sshKeys.bit4096')}</option>
    </select>
    <p class="hint">{t(dict, 'tools.sshKeys.keyType')}: {t(dict, 'tools.sshKeys.keyTypeValue1')} <code class="font-mono">ssh-rsa</code> {t(dict, 'tools.sshKeys.keyTypeValue2')}</p>
  </div>

  <button type="button" class="btn w-full" on:click={generate} disabled={isGenerating}>
    {isGenerating ? t(dict, 'tools.sshKeys.generatingKeys') : t(dict, 'tools.sshKeys.generateBtn')}
  </button>

  {#if error}
    <p class="status status--error" role="alert">{error}</p>
  {/if}
  {#if keyPair}
    <div class="stack" role="status">
      <div class="field">
        <div class="output-head">
          <span class="label" id="ssh-pub-label">{t(dict, 'tools.sshKeys.publicKey')}</span>
          <CopyButton text={keyPair.publicKey} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output class="output output--scroll" aria-labelledby="ssh-pub-label">{keyPair.publicKey}</output>
      </div>
      <div class="field">
        <div class="output-head">
          <span class="label" id="ssh-priv-label">{t(dict, 'tools.sshKeys.privateKey')}</span>
          <CopyButton text={keyPair.privateKey} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output class="output output--secret output--scroll" aria-labelledby="ssh-priv-label">{keyPair.privateKey}</output>
        <p class="hint">{t(dict, 'common.secretHint')}</p>
      </div>
    </div>
  {/if}
</div>
