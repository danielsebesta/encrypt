<script lang="ts">
  import { DEFAULT_RSA_BITS, generateSSHKeyPair, type SSHKeyType } from '../../lib/rsaKeys';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let type: SSHKeyType = 'ed25519';
  let bits = DEFAULT_RSA_BITS;
  let comment = '';
  let isGenerating = false;
  let error = '';
  let keyPair: { publicKey: string; privateKey: string } | null = null;
  let keyPairType: SSHKeyType = 'ed25519';

  async function generate() {
    error = '';
    isGenerating = true;
    try {
      keyPair = await generateSSHKeyPair({ type, bits, comment });
      keyPairType = type;
    } catch (e) {
      keyPair = null;
      error = type === 'ed25519' && e instanceof DOMException && e.name === 'NotSupportedError'
        ? t(dict, 'tools.sshKeys.ed25519Unsupported')
        : t(dict, 'tools.sshKeys.failedToGenerate');
    } finally {
      isGenerating = false;
    }
  }
</script>

<div class="stack">
  <div class="grid gap-4 sm:grid-cols-2">
    <div class="field">
      <label class="label" for="ssh-type">{t(dict, 'tools.sshKeys.keyType')}</label>
      <select id="ssh-type" bind:value={type} class="input">
        <option value="ed25519">{t(dict, 'tools.sshKeys.typeEd25519')}</option>
        <option value="rsa">{t(dict, 'tools.sshKeys.typeRsa')}</option>
      </select>
    </div>
    {#if type === 'rsa'}
      <div class="field">
        <label class="label" for="ssh-bits">{t(dict, 'tools.sshKeys.keyBitLength')}</label>
        <select id="ssh-bits" bind:value={bits} class="input">
          <option value={2048}>{t(dict, 'tools.sshKeys.bit2048')}</option>
          <option value={3072}>{t(dict, 'tools.sshKeys.bit3072')}</option>
          <option value={4096}>{t(dict, 'tools.sshKeys.bit4096')}</option>
        </select>
      </div>
    {/if}
  </div>

  <div class="field">
    <label class="label" for="ssh-comment">{t(dict, 'tools.sshKeys.comment')}</label>
    <input id="ssh-comment" class="input" bind:value={comment} maxlength="256" placeholder={t(dict, 'tools.sshKeys.commentPlaceholder')} autocomplete="off" spellcheck="false" />
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
          <span class="label" id="ssh-priv-label">{keyPairType === 'ed25519' ? t(dict, 'tools.sshKeys.privateKeyOpenssh') : t(dict, 'tools.sshKeys.privateKey')}</span>
          <CopyButton text={keyPair.privateKey} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output class="output output--secret output--scroll" aria-labelledby="ssh-priv-label">{keyPair.privateKey}</output>
        <p class="hint">{t(dict, 'common.secretHint')}</p>
      </div>
    </div>
  {/if}
</div>
