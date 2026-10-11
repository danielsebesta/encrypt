<script lang="ts">
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let input = '';
  let salt = 10;
  let hashResult = '';
  let hashError = '';
  let isHashing = false;

  let verifyInput = '';
  let verifyHash = '';
  let verifyResult: boolean | null = null;
  let verifyError = '';
  let isVerifying = false;

  async function handleHash() {
    hashError = '';
    if (!input) {
      hashError = t(dict, 'tools.bcrypt.errorNoInput');
      return;
    }
    isHashing = true;
    try {
      const { bcryptHash } = await import('../../lib/bcrypt');
      hashResult = await bcryptHash(input, salt);
    } catch {
      hashError = t(dict, 'tools.bcrypt.errorInvalidCost');
    } finally {
      isHashing = false;
    }
  }

  async function handleVerify() {
    verifyError = '';
    verifyResult = null;
    if (!verifyInput || !verifyHash) {
      verifyError = t(dict, 'tools.bcrypt.errorVerifyBoth');
      return;
    }
    isVerifying = true;
    try {
      const { bcryptVerify } = await import('../../lib/bcrypt');
      verifyResult = await bcryptVerify(verifyInput, verifyHash.trim());
    } catch {
      verifyError = t(dict, 'tools.bcrypt.errorInvalidHash');
    } finally {
      isVerifying = false;
    }
  }
</script>

<div class="stack">
  <section class="stack" aria-labelledby="bcrypt-hash-title">
    <h2 id="bcrypt-hash-title" class="section-title">{t(dict, 'tools.bcrypt.generateHash')}</h2>
    <div class="field">
      <label class="label" for="bcrypt-text">{t(dict, 'tools.bcrypt.cleartextInput')}</label>
      <input id="bcrypt-text" class="input" bind:value={input} placeholder={t(dict, 'tools.bcrypt.hashPlaceholder')} autocomplete="off" />
    </div>
    <details class="more">
      <summary>{t(dict, 'tools.bcrypt.costRounds')}</summary>
      <div class="more__body">
        <div class="field">
          <label class="label" for="bcrypt-cost">{t(dict, 'tools.bcrypt.costRounds')}</label>
          <input id="bcrypt-cost" type="number" inputmode="numeric" bind:value={salt} min="4" max="15" class="input max-w-32" aria-describedby="bcrypt-cost-hint" />
          <p id="bcrypt-cost-hint" class="hint">{t(dict, 'tools.bcrypt.costHint')}</p>
        </div>
      </div>
    </details>
    <button type="button" class="btn w-full" on:click={handleHash} disabled={isHashing}>{isHashing ? t(dict, 'tools.bcrypt.computing') : t(dict, 'tools.bcrypt.generateBtn')}</button>
    {#if hashError}
      <p class="status status--error" role="alert">{hashError}</p>
    {/if}
    {#if hashResult}
      <div class="field">
        <div class="output-head">
          <span class="label" id="bcrypt-out-label">{t(dict, 'tools.bcrypt.hashOutput')}</span>
          <CopyButton text={hashResult} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output class="output output--ok" aria-labelledby="bcrypt-out-label" aria-live="polite">{hashResult}</output>
      </div>
    {/if}
  </section>

  <hr class="border-line-soft" />

  <section class="stack" aria-labelledby="bcrypt-verify-title">
    <h2 id="bcrypt-verify-title" class="section-title">{t(dict, 'tools.bcrypt.verifyHashTitle')}</h2>
    <div class="field">
      <label class="label" for="bcrypt-verify-text">{t(dict, 'tools.bcrypt.cleartextInput')}</label>
      <input id="bcrypt-verify-text" class="input" bind:value={verifyInput} placeholder={t(dict, 'tools.bcrypt.hashPlaceholder')} autocomplete="off" />
    </div>
    <div class="field">
      <label class="label" for="bcrypt-hash">{t(dict, 'tools.bcrypt.hashToCompare')}</label>
      <input id="bcrypt-hash" class="input input--mono" bind:value={verifyHash} placeholder={t(dict, 'tools.bcrypt.pasteHash')} autocomplete="off" spellcheck="false" />
    </div>
    <button type="button" class="btn-secondary w-full" on:click={handleVerify} disabled={isVerifying}>{isVerifying ? t(dict, 'tools.bcrypt.computing') : t(dict, 'tools.bcrypt.verifyMatch')}</button>
    {#if verifyError}
      <p class="status status--error" role="alert">{verifyError}</p>
    {/if}
    {#if verifyResult !== null}
      <div class="status {verifyResult ? 'status--ok' : 'status--error'}" role="status">
        <div>
          <p class="status__title">{verifyResult ? t(dict, 'tools.bcrypt.matchConfirmed') : t(dict, 'tools.bcrypt.invalidMatch')}</p>
          <p>{verifyResult ? t(dict, 'tools.bcrypt.matchText') : t(dict, 'tools.bcrypt.invalidText')}</p>
        </div>
      </div>
    {/if}
  </section>
</div>
