<script lang="ts">
  import { onMount } from 'svelte';
  import { checkRoomPassword, passwordLongEnough } from '../../lib/chatRoomSettings';
  import { generatePassphrase } from '../../lib/passphrase';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';
  import PassphraseField from '../PassphraseField.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import CoverStream from './CoverStream.svelte';
  import {
    COVER_LANGS,
    chatCipherErrorKey,
    chatCipherErrorRetryable,
    decryptFromChat,
    decryptFromChatAuto,
    dropRetiredModels,
    encryptToChat,
    preferredCoverLang,
    reloadCoverCodec,
    warmCoverTable,
    type ChatCipherErrorKey,
    type ChatCipherPhase,
    type ChatCipherProgressInfo,
    type CoverLang,
  } from '../../lib/chatCipher';

  export let dict: Record<string, string>;
  export let pageLang: string = 'en';

  let mode: 'encrypt' | 'decrypt' = 'encrypt';
  let coverChoice: CoverLang | 'auto' = 'auto';
  let autoLang: CoverLang = preferredCoverLang(pageLang);
  let detectedLang: CoverLang | null = null;
  let inputText = '';
  let password = '';
  let result = '';
  let error = '';
  let errorKey: ChatCipherErrorKey | '' = '';
  let busy = false;
  let progressTitle = '';
  let progressDetail = '';
  let coverRatio: number | null = null;
  let streamWaiting = false;
  let streamDone = true;
  let streamWaiter: (() => void) | null = null;

  $: coverLang = coverChoice === 'auto' ? autoLang : coverChoice;
  $: autoLabel = t(dict, 'tools.chatCipher.lang.auto').replace('{lang}', t(dict, `tools.chatCipher.lang.${autoLang}`));
  $: passwordChecks = checkRoomPassword(password, '');
  $: passwordRules = [
    { ok: passwordChecks.length, label: t(dict, 'common.passwordRuleLength') },
    { ok: passwordChecks.variety, label: t(dict, 'common.passwordRuleVariety') },
    { ok: passwordChecks.strength, label: t(dict, 'common.passwordRuleStrength') },
  ];

  onMount(() => {
    autoLang = preferredCoverLang(pageLang, navigator.languages?.length ? navigator.languages : [navigator.language]);
    void warmCoverTable(autoLang);
    void dropRetiredModels().catch(() => {});
  });

  function onCoverLangChange() {
    clearError();
    result = '';
    detectedLang = null;
    void warmCoverTable(coverChoice === 'auto' ? autoLang : coverChoice);
  }

  function clearError() {
    error = '';
    errorKey = '';
  }

  function showError(e: unknown) {
    errorKey = chatCipherErrorKey(e);
    error = t(dict, errorKey);
    if (errorKey === 'tools.chatCipher.errorCoverMismatch' && coverChoice !== 'auto') error += ` ${t(dict, 'tools.chatCipher.errorTryAuto')}`;
    const detail = e instanceof Error && e.message ? e.message : '';
    if (detail && typeof console !== 'undefined') console.error('[chat-cipher]', detail, e);
  }

  function setProgress(phase: ChatCipherPhase, info?: ChatCipherProgressInfo) {
    if (phase === 'seal') {
      streamWaiting = mode === 'encrypt';
      coverRatio = null;
      progressTitle = t(dict, 'tools.chatCipher.progress.sealTitle');
      progressDetail = t(dict, 'tools.chatCipher.progress.sealDetail');
    } else if (phase === 'cover') {
      const pct =
        info && info.total && info.total > 0 && typeof info.done === 'number'
          ? Math.min(100, Math.round((100 * info.done) / info.total))
          : null;
      coverRatio = pct == null ? null : pct / 100;
      streamWaiting = mode === 'encrypt';
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

  function onStreamDone() {
    streamDone = true;
    streamWaiting = false;
    streamWaiter?.();
    streamWaiter = null;
  }

  function waitForStream(): Promise<void> {
    if (streamDone) return Promise.resolve();
    return new Promise(resolve => {
      streamWaiter = resolve;
    });
  }

  async function run(work: () => Promise<void>) {
    busy = true;
    progressTitle = t(dict, 'tools.chatCipher.progress.startingTitle');
    progressDetail = t(dict, 'tools.chatCipher.progress.startingDetail');
    try {
      await work();
    } catch (e: unknown) {
      showError(e);
      streamWaiting = false;
      streamDone = true;
      coverRatio = null;
    } finally {
      busy = false;
      progressTitle = '';
      progressDetail = '';
    }
  }

  async function handleProcess() {
    clearError();
    result = '';
    detectedLang = null;
    coverRatio = null;
    streamDone = true;
    streamWaiting = mode === 'encrypt';
    if (!inputText || !password) {
      errorKey = 'tools.chatCipher.errorBoth';
      error = t(dict, errorKey);
      streamWaiting = false;
      return;
    }
    if (mode === 'encrypt' && !passwordLongEnough(password)) {
      error = t(dict, 'common.passwordTooShort');
      streamWaiting = false;
      return;
    }
    await run(async () => {
      let text: string;
      if (mode === 'encrypt') {
        text = await encryptToChat(inputText, password, setProgress, coverLang);
      } else if (coverChoice === 'auto') {
        const opened = await decryptFromChatAuto(inputText, password, setProgress, autoLang);
        text = opened.text;
        detectedLang = opened.lang;
      } else {
        text = await decryptFromChat(inputText, password, setProgress, coverChoice);
      }
      if (mode === 'encrypt') {
        streamDone = false;
        streamWaiting = false;
        progressTitle = '';
        progressDetail = '';
        coverRatio = null;
        result = text;
        await waitForStream();
      } else {
        result = text;
      }
    });
  }

  async function redownloadTable() {
    clearError();
    await run(async () => {
      await reloadCoverCodec(coverLang);
    });
  }

  function toggleMode() {
    mode = mode === 'encrypt' ? 'decrypt' : 'encrypt';
    inputText = '';
    result = '';
    detectedLang = null;
    onStreamDone();
    coverRatio = null;
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
      <label for="chat-cipher-lang" class="label">{t(dict, 'tools.chatCipher.coverLang')}</label>
      <select
        id="chat-cipher-lang"
        class="input"
        bind:value={coverChoice}
        disabled={busy}
        on:change={onCoverLangChange}
      >
        <option value="auto">{autoLabel}</option>
        {#each COVER_LANGS as lang}
          <option value={lang}>{t(dict, `tools.chatCipher.lang.${lang}`)}</option>
        {/each}
      </select>
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
        disabled={busy}
      ></textarea>
    </div>

    <div class="field">
      <label for="chat-cipher-password" class="label">{t(dict, 'tools.chatCipher.password')}</label>
      {#if mode === 'encrypt'}
        <PassphraseField {dict} id="chat-cipher-password" bind:value={password} placeholder={t(dict, 'tools.chatCipher.passwordPlaceholder')} describedby="chat-cipher-password-rules" generate={generatePassphrase} />
        <PasswordChecklist id="chat-cipher-password-rules" label={t(dict, 'common.passwordRules')} rules={passwordRules} />
      {:else}
        <input
          id="chat-cipher-password"
          type="password"
          bind:value={password}
          placeholder={t(dict, 'tools.chatCipher.passwordPlaceholder')}
          class="input"
          autocomplete="current-password"
          spellcheck="false"
          autocapitalize="off"
          data-lpignore="true"
          data-1p-ignore
          disabled={busy}
        />
      {/if}
    </div>

    <button type="button" class="btn w-full" disabled={busy} on:click={handleProcess}>
      {#if busy}
        {t(dict, 'tools.chatCipher.progress.workingBtn')}
      {:else}
        {mode === 'encrypt' ? t(dict, 'tools.chatCipher.encryptBtn') : t(dict, 'tools.chatCipher.decryptBtn')}
      {/if}
    </button>

    {#if busy}
      <ProgressPulse title={progressTitle} detail={progressDetail} ratio={coverRatio} />
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
    {#if mode === 'encrypt' && (streamWaiting || result)}
      <div class="field">
        <div class="output-head">
          <span class="label" id="chat-cipher-out-label">{t(dict, 'tools.chatCipher.coverOutput')}</span>
          {#if result && streamDone}
            <CopyButton text={result} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
          {/if}
        </div>
        <CoverStream
          target={result}
          waiting={streamWaiting && !result}
          labelledby="chat-cipher-out-label"
          on:done={onStreamDone}
        />
      </div>
    {:else if result}
      <div class="field">
        <div class="output-head">
          <span class="label" id="chat-cipher-out-label">{t(dict, 'tools.chatCipher.plainOutput')}</span>
          <CopyButton text={result} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} />
        </div>
        <output
          class="output output--ok break-words"
          aria-labelledby="chat-cipher-out-label"
          aria-live="polite"
        >{result}</output>
        {#if detectedLang}
          <p class="hint">{t(dict, 'tools.chatCipher.detectedLang').replace('{lang}', t(dict, `tools.chatCipher.lang.${detectedLang}`))}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
