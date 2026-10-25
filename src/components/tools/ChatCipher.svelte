<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';
  import {
    decryptFromChat,
    encryptToChat,
    ensurePack,
    getPackStatus,
    packTotalBytes,
    PACKS,
    type ChatLanguage,
    type PackStatus,
  } from '../../lib/chatCipher';

  export let locale = 'en';
  export let dict: Record<string, string>;

  let mode: 'encrypt' | 'decrypt' = 'encrypt';
  let lang: ChatLanguage = locale === 'cs' ? 'cs' : 'en';
  let inputText = '';
  let password = '';
  let result = '';
  let error = '';
  let busy = false;
  let pack: PackStatus = PACKS[lang].bundled
    ? { state: 'bundled' }
    : { state: 'missing', bytes: packTotalBytes(PACKS[lang]) };

  onMount(() => {
    void refreshPack(lang);
  });

  async function refreshPack(next: ChatLanguage) {
    try {
      pack = await getPackStatus(next);
    } catch {
      pack = { state: 'missing', bytes: packTotalBytes(PACKS[next]) };
    }
  }

  function setLang(next: ChatLanguage) {
    lang = next;
    result = '';
    error = '';
    void refreshPack(next);
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function download() {
    error = '';
    try {
      await ensurePack(lang, status => {
        pack = status;
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t(dict, 'tools.chatCipher.errorPack');
      pack = { state: 'error', message };
      error = message;
    }
  }

  async function handleProcess() {
    error = '';
    result = '';
    if (!inputText || !password) {
      error = t(dict, 'tools.chatCipher.errorBoth');
      return;
    }
    if (pack.state !== 'bundled' && pack.state !== 'ready') {
      error = t(dict, 'tools.chatCipher.errorNeedPack');
      return;
    }
    busy = true;
    try {
      result =
        mode === 'encrypt'
          ? await encryptToChat(inputText, password, lang)
          : await decryptFromChat(inputText, password, lang);
    } catch (e: unknown) {
      error = e instanceof Error && e.message ? e.message : t(dict, 'tools.chatCipher.errorGeneric');
    } finally {
      busy = false;
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
  <div class="tabs" role="tablist" aria-label={t(dict, 'tools.chatCipher.h1')}>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'encrypt'} aria-controls="chat-cipher-panel" on:click={() => { if (mode !== 'encrypt') toggleMode(); }}>{t(dict, 'tools.chatCipher.encrypt')}</button>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'decrypt'} aria-controls="chat-cipher-panel" on:click={() => { if (mode !== 'decrypt') toggleMode(); }}>{t(dict, 'tools.chatCipher.decrypt')}</button>
  </div>

  <div id="chat-cipher-panel" role="tabpanel" class="stack">
    <div class="field">
      <span class="label" id="chat-cipher-lang-label">{t(dict, 'tools.chatCipher.language')}</span>
      <div class="tabs" role="radiogroup" aria-labelledby="chat-cipher-lang-label">
        <button type="button" class="tab" role="radio" aria-checked={lang === 'cs'} on:click={() => setLang('cs')}>{t(dict, 'tools.chatCipher.lang.cs')}</button>
        <button type="button" class="tab" role="radio" aria-checked={lang === 'en'} on:click={() => setLang('en')}>{t(dict, 'tools.chatCipher.lang.en')}</button>
      </div>
    </div>

    <div class="field">
      {#if pack.state === 'bundled'}
        <p class="status">{t(dict, 'tools.chatCipher.pack.bundled')}</p>
      {:else if pack.state === 'ready'}
        <p class="status">{t(dict, 'tools.chatCipher.pack.ready')}</p>
      {:else if pack.state === 'downloading'}
        <p class="status">{t(dict, 'tools.chatCipher.pack.downloading').replace('{received}', formatBytes(pack.received)).replace('{total}', formatBytes(pack.total))}</p>
      {:else if pack.state === 'error'}
        <p class="status status--error" role="alert">{pack.message}</p>
        <button type="button" class="btn" on:click={download}>{t(dict, 'tools.chatCipher.pack.retry')}</button>
      {:else}
        <p class="status">{t(dict, 'tools.chatCipher.pack.missing').replace('{size}', formatBytes(pack.bytes || packTotalBytes(PACKS[lang])))}</p>
        <button type="button" class="btn" on:click={download}>{t(dict, 'tools.chatCipher.pack.download')}</button>
      {/if}
    </div>

    <div class="field">
      <label for="chat-cipher-input" class="label">{mode === 'encrypt' ? t(dict, 'tools.chatCipher.inputText') : t(dict, 'tools.chatCipher.coverText')}</label>
      <textarea
        id="chat-cipher-input"
        bind:value={inputText}
        placeholder={mode === 'encrypt' ? t(dict, 'tools.chatCipher.encryptPlaceholder') : t(dict, 'tools.chatCipher.decryptPlaceholder')}
        class="input"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
      ></textarea>
    </div>

    <div class="field">
      <label for="chat-cipher-password" class="label">{t(dict, 'tools.chatCipher.password')}</label>
      <input
        id="chat-cipher-password"
        type="password"
        bind:value={password}
        placeholder={t(dict, 'tools.chatCipher.passwordPlaceholder')}
        class="input"
        autocomplete={mode === 'encrypt' ? 'new-password' : 'current-password'}
        spellcheck="false"
        autocapitalize="off"
        data-lpignore="true"
        data-1p-ignore
      />
    </div>

    <button type="button" class="btn w-full" disabled={busy || (pack.state !== 'bundled' && pack.state !== 'ready')} on:click={handleProcess}>
      {mode === 'encrypt' ? t(dict, 'tools.chatCipher.encryptBtn') : t(dict, 'tools.chatCipher.decryptBtn')}
    </button>

    {#if error}
      <p class="status status--error" role="alert">{error}</p>
    {/if}
    {#if result}
      <div class="field">
        <div class="output-head">
          <span class="label" id="chat-cipher-out-label">{mode === 'encrypt' ? t(dict, 'tools.chatCipher.coverOutput') : t(dict, 'tools.chatCipher.plainOutput')}</span>
          <CopyButton text={result} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output class="output output--ok break-words" aria-labelledby="chat-cipher-out-label" aria-live="polite">{result}</output>
      </div>
    {/if}
  </div>
</div>
