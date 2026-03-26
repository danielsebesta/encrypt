<script lang="ts">
  import dictionary from '../../lib/dictionary.json';
  import { encrypt, decrypt as decryptMsg, to14BitChunks, from14BitChunks } from '../../lib/crypto';
  import { getTranslations, t } from '../../lib/i18n';
  export let locale = 'en';
  $: dict = getTranslations(locale);
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
      if (mode === 'encrypt') {
        const encryptedData = await encrypt(inputText, password);
        const chunks = to14BitChunks(encryptedData);
        const words = chunks.map(index => dictionary[index]);
        result = words.join(' ');
      } else {
        const words = inputText.trim().split(/\s+/);
        const chunks = words.map(word => {
          const index = dictionary.indexOf(word.toLowerCase());
          if (index === -1) throw new Error(`Word not found in dictionary: ${word}`);
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

<div class="space-y-5">
  <div class="tab-bar">
    <button
      on:click={toggleMode}
      class="tab-btn {mode === 'encrypt' ? 'tab-btn-active' : ''}"
    >
      {t(dict, 'tools.aesWords.encrypt')}
    </button>
    <button
      on:click={toggleMode}
      class="tab-btn {mode === 'decrypt' ? 'tab-btn-active' : ''}"
    >
      {t(dict, 'tools.aesWords.decrypt')}
    </button>
  </div>
  <div class="grid gap-4">
    <div class="grid gap-1.5">
      <label for="cipher-password" class="label">{t(dict, 'tools.aesWords.secretPassword')}</label>
      <input
        id="cipher-password"
        type="password"
        bind:value={password}
        placeholder={t(dict, 'tools.aesWords.passwordPlaceholder')}
        class="input"
        autocomplete="new-password"
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"
        data-lpignore="true"
        data-1p-ignore
      />
    </div>
    <div class="grid gap-1.5">
      <label for="cipher-input" class="label">
        {mode === 'encrypt' ? t(dict, 'tools.aesWords.inputText') : t(dict, 'tools.aesWords.wordsToDecrypt')}
      </label>
      <textarea
        id="cipher-input"
        bind:value={inputText}
        placeholder={mode === 'encrypt' ? t(dict, 'tools.aesWords.encryptPlaceholder') : t(dict, 'tools.aesWords.decryptPlaceholder')}
        class="input min-h-[140px] resize-none"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
      ></textarea>
    </div>
  </div>
  <button
    on:click={handleProcess}
    class="btn w-full"
  >
    {mode === 'encrypt' ? t(dict, 'tools.aesWords.generateWords') : t(dict, 'tools.aesWords.recoverText')}
  </button>
  {#if error}
    <div class="error-box">
      {error}
    </div>
  {/if}
  {#if result}
    <div class="grid gap-1.5 pt-2">
      <label class="label">
        {mode === 'encrypt' ? t(dict, 'tools.aesWords.ciphertextWords') : t(dict, 'tools.aesWords.decryptedOutput')}
      </label>
      <div class="result-box leading-relaxed">
        {result}
      </div>
    </div>
  {/if}
</div>
