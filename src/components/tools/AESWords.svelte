<script lang="ts">
  import { encrypt, decrypt as decryptMsg, to14BitChunks, from14BitChunks } from '../../lib/aesGcm';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';
  export let locale = 'en';
  export let dict: Record<string, string>;
  let mode: 'encrypt' | 'decrypt' = 'encrypt';
  let inputText = '';
  let password = '';
  let result = '';
  let error = '';
  async function handleProcess() {
    error = '';
    result = '';
    if (!inputText || !password) {
      error = t(dict, 'tools.aesWords.errorBoth');
      return;
    }
    try {
      const { default: dictionary } = await import('../../lib/dictionary.json');
      if (mode === 'encrypt') {
        const encryptedData = await encrypt(inputText, password);
        const chunks = to14BitChunks(encryptedData);
        const words = chunks.map(index => dictionary[index]);
        result = words.join(' ');
      } else {
        const words = inputText.trim().split(/\s+/);
        const chunks = words.map(word => {
          const index = dictionary.indexOf(word.toLowerCase());
          if (index === -1) {
            throw new Error(t(dict, 'tools.aesWords.errorWordNotFound').replace('{word}', word));
          }
          return index;
        });
        const encryptedData = from14BitChunks(chunks);
        result = await decryptMsg(encryptedData, password);
      }
    } catch (e: any) {
      error = e.message || t(dict, 'tools.aesWords.errorGeneric');
    }
  }
  function toggleMode() {
    mode = mode === 'encrypt' ? 'decrypt' : 'encrypt';
    inputText = '';
    result = '';
    error = '';
  }
</script>
<div class="stack">
  <div class="tabs" role="tablist" aria-label={t(dict, 'tools.aesWords.h1')}>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'encrypt'} aria-controls="aes-panel" on:click={() => { if (mode !== 'encrypt') toggleMode(); }}>{t(dict, 'tools.aesWords.encrypt')}</button>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'decrypt'} aria-controls="aes-panel" on:click={() => { if (mode !== 'decrypt') toggleMode(); }}>{t(dict, 'tools.aesWords.decrypt')}</button>
  </div>

  <div id="aes-panel" role="tabpanel" class="stack">
    <div class="field">
      <label for="cipher-input" class="label">{mode === 'encrypt' ? t(dict, 'tools.aesWords.inputText') : t(dict, 'tools.aesWords.wordsToDecrypt')}</label>
      <textarea
        id="cipher-input"
        bind:value={inputText}
        placeholder={mode === 'encrypt' ? t(dict, 'tools.aesWords.encryptPlaceholder') : t(dict, 'tools.aesWords.decryptPlaceholder')}
        class="input"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
      ></textarea>
    </div>
    <div class="field">
      <label for="cipher-password" class="label">{t(dict, 'tools.aesWords.secretPassword')}</label>
      <input
        id="cipher-password"
        type="password"
        bind:value={password}
        placeholder={t(dict, 'tools.aesWords.passwordPlaceholder')}
        class="input"
        autocomplete={mode === 'encrypt' ? 'new-password' : 'current-password'}
        spellcheck="false"
        autocapitalize="off"
        data-lpignore="true"
        data-1p-ignore
      />
    </div>

    <button type="button" class="btn w-full" on:click={handleProcess}>
      {mode === 'encrypt' ? t(dict, 'tools.aesWords.generateWords') : t(dict, 'tools.aesWords.recoverText')}
    </button>

    {#if error}
      <p class="status status--error" role="alert">{error}</p>
    {/if}
    {#if result}
      <div class="field">
        <div class="output-head">
          <span class="label" id="aes-out-label">{mode === 'encrypt' ? t(dict, 'tools.aesWords.ciphertextWords') : t(dict, 'tools.aesWords.decryptedOutput')}</span>
          <CopyButton text={result} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output class="output output--ok break-words" aria-labelledby="aes-out-label" aria-live="polite">{result}</output>
      </div>
    {/if}
  </div>
</div>
