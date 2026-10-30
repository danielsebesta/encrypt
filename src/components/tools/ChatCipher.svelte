<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import {
    chatCipherErrorKey,
    chatCipherErrorRetryable,
    decryptFromChat,
    dropRetiredModels,
    encryptToChat,
    reloadCoverCodec,
    warmCoverTable,
    type ChatCipherErrorKey,
    type ChatCipherPhase,
    type ChatCipherProgressInfo,
  } from '../../lib/chatCipher';

  export let dict: Record<string, string>;

  let mode: 'encrypt' | 'decrypt' = 'encrypt';
  let inputText = '';
  let password = '';
  let result = '';
  let error = '';
  let errorKey: ChatCipherErrorKey | '' = '';
  let busy = false;
  let progressTitle = '';
  let progressDetail = '';

  onMount(() => {
    void warmCoverTable();
    void dropRetiredModels().catch(() => {});
  });

  function clearError() {
    error = '';
    errorKey = '';
  }

  function showError(e: unknown) {
    errorKey = chatCipherErrorKey(e);
    error = t(dict, errorKey);
    const detail = e instanceof Error && e.message ? e.message : '';
    if (detail && typeof console !== 'undefined') console.error('[chat-cipher]', detail, e);
  }

  function setProgress(phase: ChatCipherPhase, info?: ChatCipherProgressInfo) {
    if (phase === 'seal') {
      progressTitle = t(dict, 'tools.chatCipher.progress.sealTitle');
      progressDetail = t(dict, 'tools.chatCipher.progress.sealDetail');
    } else if (phase === 'cover') {
      const pct =
        info && info.total && info.total > 0 && typeof info.done === 'number'
          ? Math.min(100, Math.round((100 * info.done) / info.total))
          : null;
      progressTitle =
        mode === 'encrypt'
          ? t(dict, 'tools.chatCipher.progress.writeTitle')
          : t(dict, 'tools.chatCipher.progress.readTitle');
      progressDetail =
        pct == null
          ? t(dict, 'tools.chatCipher.progress.coverDetail')
          : t(dict, 'tools.chatCipher.progress.coverPct').replace('{pct}', String(pct));
    } else {
      progressTitle = t(dict, 'tools.chatCipher.progress.openTitle');
      progressDetail = t(dict, 'tools.chatCipher.progress.openDetail');
    }
  }

  async function run(work: () => Promise<void>) {
    busy = true;
    progressTitle = t(dict, 'tools.chatCipher.progress.startingTitle');
    progressDetail = t(dict, 'tools.chatCipher.progress.startingDetail');
    try {
      await work();
    } catch (e: unknown) {
      showError(e);
    } finally {
      busy = false;
      progressTitle = '';
      progressDetail = '';
    }
  }

  async function handleProcess() {
    clearError();
    result = '';
    if (!inputText || !password) {
      errorKey = 'tools.chatCipher.errorBoth';
      error = t(dict, errorKey);
      return;
    }
    await run(async () => {
      result =
        mode === 'encrypt'
          ? await encryptToChat(inputText, password, setProgress)
          : await decryptFromChat(inputText, password, setProgress);
    });
  }

  async function redownloadTable() {
    clearError();
    await run(async () => {
      await reloadCoverCodec();
    });
  }

  function toggleMode() {
    mode = mode === 'encrypt' ? 'decrypt' : 'encrypt';
    inputText = '';
    result = '';
    clearError();
  }
</script>

<div class="stack">
  <div class="tabs" role="tablist" aria-label={t(dict, 'tools.chatCipher.h1')}>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'encrypt'} aria-controls="chat-cipher-panel" on:click={() => { if (mode !== 'encrypt') toggleMode(); }}>{t(dict, 'tools.chatCipher.encrypt')}</button>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'decrypt'} aria-controls="chat-cipher-panel" on:click={() => { if (mode !== 'decrypt') toggleMode(); }}>{t(dict, 'tools.chatCipher.decrypt')}</button>
  </div>

  <div id="chat-cipher-panel" role="tabpanel" class="stack">
    <p class="status">{t(dict, 'tools.chatCipher.tableNote')}</p>

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
        disabled={busy}
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
        disabled={busy}
      />
    </div>

    <button type="button" class="btn w-full" disabled={busy} on:click={handleProcess}>
      {#if busy}
        {t(dict, 'tools.chatCipher.progress.workingBtn')}
      {:else}
        {mode === 'encrypt' ? t(dict, 'tools.chatCipher.encryptBtn') : t(dict, 'tools.chatCipher.decryptBtn')}
      {/if}
    </button>

    {#if busy}
      <ProgressPulse title={progressTitle} detail={progressDetail} />
    {/if}

    {#if error}
      <div class="status status--error" role="alert">
        <div>
          <p class="status__title">{error}</p>
          {#if errorKey && chatCipherErrorRetryable(errorKey)}
            <button type="button" class="btn-ghost btn-sm" disabled={busy} on:click={redownloadTable}>
              {t(dict, 'tools.chatCipher.errorRetryTable')}
            </button>
          {/if}
        </div>
      </div>
    {/if}
    {#if result}
      <div class="field">
        <div class="output-head">
          <span class="label" id="chat-cipher-out-label">{mode === 'encrypt' ? t(dict, 'tools.chatCipher.coverOutput') : t(dict, 'tools.chatCipher.plainOutput')}</span>
          <CopyButton text={result} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output
          class="output output--ok {mode === 'encrypt' ? 'cipher-cover' : 'break-words'}"
          aria-labelledby="chat-cipher-out-label"
          aria-live="polite"
        >{result}</output>
      </div>
    {/if}
  </div>
</div>

<style>
  :global(.cipher-cover) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
  }
</style>
