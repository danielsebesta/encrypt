<script lang="ts">
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let name = '';
  let email = '';
  let passphrase = '';
  let keyType: 'curve25519' | 'rsa' = 'curve25519';
  let rsaBits = 4096;
  let isGenerating = false;
  let keyPair: { publicKey: string; privateKey: string } | null = null;
  let error = '';

  async function generate() {
    error = '';
    keyPair = null;
    if (!name.trim() || !email.trim()) {
      error = t(dict, 'tools.pgpKeys.nameEmailRequired');
      return;
    }
    isGenerating = true;
    try {
      const { generatePGPKeyPair } = await import('../../lib/pgpKeys');
      keyPair = await generatePGPKeyPair({ name: name.trim(), email: email.trim(), passphrase, type: keyType, rsaBits });
    } catch (e: any) {
      error = e?.message || t(dict, 'tools.pgpKeys.failedToGenerate');
    } finally {
      isGenerating = false;
    }
  }
</script>

<div class="stack">
  <div class="grid gap-4 sm:grid-cols-2">
    <div class="field">
      <label class="label" for="pgp-name">{t(dict, 'tools.pgpKeys.name')}</label>
      <input id="pgp-name" class="input" bind:value={name} placeholder={t(dict, 'tools.pgpKeys.namePlaceholder')} autocomplete="name" aria-invalid={error && !name.trim() ? 'true' : undefined} />
    </div>
    <div class="field">
      <label class="label" for="pgp-email">{t(dict, 'tools.pgpKeys.email')}</label>
      <input id="pgp-email" class="input" type="email" bind:value={email} placeholder={t(dict, 'tools.pgpKeys.emailPlaceholder')} autocomplete="email" aria-invalid={error && !email.trim() ? 'true' : undefined} />
    </div>
  </div>

  <details class="more">
    <summary>{t(dict, 'tools.pgpKeys.moreOptions')}</summary>
    <div class="more__body">
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="field">
          <label class="label" for="pgp-pass">{t(dict, 'tools.pgpKeys.keyPassphrase')}</label>
          <input id="pgp-pass" class="input" type="password" bind:value={passphrase} autocomplete="new-password" placeholder={t(dict, 'tools.pgpKeys.passphrasePlaceholder')} />
        </div>
        <div class="field">
          <label class="label" for="pgp-type">{t(dict, 'tools.pgpKeys.keyType')}</label>
          <select id="pgp-type" bind:value={keyType} class="input">
            <option value="curve25519">{t(dict, 'tools.pgpKeys.typeCurve25519')}</option>
            <option value="rsa">{t(dict, 'tools.pgpKeys.typeRsa')}</option>
          </select>
        </div>
        {#if keyType === 'rsa'}
          <div class="field">
            <label class="label" for="pgp-bits">{t(dict, 'tools.pgpKeys.rsaStrength')}</label>
            <select id="pgp-bits" bind:value={rsaBits} class="input">
              <option value={2048}>{t(dict, 'tools.pgpKeys.bit2048')}</option>
              <option value={4096}>{t(dict, 'tools.pgpKeys.bit4096')}</option>
            </select>
          </div>
        {/if}
      </div>
    </div>
  </details>

  <button type="button" class="btn w-full" on:click={generate} disabled={isGenerating}>
    {isGenerating ? t(dict, 'tools.pgpKeys.generatingKeys') : t(dict, 'tools.pgpKeys.generateBtn')}
  </button>

  {#if error}
    <p class="status status--error" role="alert">{error}</p>
  {/if}
  {#if keyPair}
    <div class="stack" role="status">
      <div class="field">
        <div class="output-head">
          <span class="label" id="pgp-pub-label">{t(dict, 'tools.pgpKeys.publicKey')}</span>
          <CopyButton text={keyPair.publicKey} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output class="output output--scroll" aria-labelledby="pgp-pub-label">{keyPair.publicKey}</output>
      </div>
      <div class="field">
        <div class="output-head">
          <span class="label" id="pgp-priv-label">{t(dict, 'tools.pgpKeys.privateKey')}</span>
          <CopyButton text={keyPair.privateKey} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output class="output output--secret output--scroll" aria-labelledby="pgp-priv-label">{keyPair.privateKey}</output>
        <p class="hint">{t(dict, 'common.secretHint')}</p>
      </div>
    </div>
  {/if}
</div>
