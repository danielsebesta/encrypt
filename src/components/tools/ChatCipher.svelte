<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '../ui/Button.svelte';
  import Field from '../ui/Field.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import { focusFirstInvalid } from '../../lib/focusInvalid';
  import { checkRoomPassword, passwordLongEnough } from '../../lib/chatRoomSettings';
  import { generatePassphrase } from '../../lib/passphrase';
  import { t } from '../../lib/t';
  import PassphraseField from '../PassphraseField.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import CoverStream from './CoverStream.svelte';
  import ToolResult from './ToolResult.svelte';
  import ToolStatus from './ToolStatus.svelte';
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
  let attempted = false;
  let panelEl: HTMLElement;
  let busy = false;
  let progressTitle = '';
  let progressDetail = '';
  let coverRatio: number | null = null;
  let streamWaiting = false;
  let streamDone = true;
  let streamWaiter: (() => void) | null = null;

  $: inputError = attempted && !inputText ? t(dict, 'common.fieldRequired') : '';
  $: passwordError = attempted && !password ? t(dict, 'common.fieldRequired') : attempted && mode === 'encrypt' && !passwordLongEnough(password) ? t(dict, 'common.passwordTooShort') : '';
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
    attempted = true;
    if (!inputText || !password || (mode === 'encrypt' && !passwordLongEnough(password))) {
      streamWaiting = false;
      void focusFirstInvalid(panelEl);
      return;
    }
    streamWaiting = mode === 'encrypt';
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
    attempted = false;
    clearError();
  }
</script>

<div class="stack" bind:this={panelEl}>
  <Tabs items={[{ id: 'encrypt', label: t(dict, 'tools.chatCipher.encrypt') }, { id: 'decrypt', label: t(dict, 'tools.chatCipher.decrypt') }]} value={mode} label={t(dict, 'tools.chatCipher.h1')} idBase="chat-cipher" panelClass="stack" onchange={toggleMode}>
    <p class="status">{t(dict, 'tools.chatCipher.tableNote')}</p>

    <form class="stack" novalidate on:submit|preventDefault={handleProcess}>
      <Field label={t(dict, 'tools.chatCipher.coverLang')}>
        {#snippet children(control)}
          <select {...control} class="input" bind:value={coverChoice} disabled={busy} on:change={onCoverLangChange}>
            <option value="auto">{autoLabel}</option>
            {#each COVER_LANGS as lang}
              <option value={lang}>{t(dict, `tools.chatCipher.lang.${lang}`)}</option>
            {/each}
          </select>
        {/snippet}
      </Field>

      <Field label={mode === 'encrypt' ? t(dict, 'tools.chatCipher.inputText') : t(dict, 'tools.chatCipher.coverText')} error={inputError} required>
        {#snippet children(control)}
          <textarea
            {...control}
            bind:value={inputText}
            placeholder={mode === 'encrypt' ? t(dict, 'tools.chatCipher.encryptPlaceholder') : t(dict, 'tools.chatCipher.decryptPlaceholder')}
            class="input"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            disabled={busy}
          ></textarea>
        {/snippet}
      </Field>

      <Field label={t(dict, 'tools.chatCipher.password')} error={passwordError} required>
        {#snippet children(control)}
          {#if mode === 'encrypt'}
            <PassphraseField {dict} id={control.id} bind:value={password} placeholder={t(dict, 'tools.chatCipher.passwordPlaceholder')} describedby={[control['aria-describedby'], 'chat-cipher-password-rules'].filter(Boolean).join(' ')} invalid={!!passwordError} generate={generatePassphrase} />
            <PasswordChecklist id="chat-cipher-password-rules" label={t(dict, 'common.passwordRules')} rules={passwordRules} {dict} />
          {:else}
            <input
              {...control}
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
        {/snippet}
      </Field>

      <Button type="submit" block {busy}>{mode === 'encrypt' ? t(dict, 'tools.chatCipher.encryptBtn') : t(dict, 'tools.chatCipher.decryptBtn')}</Button>
    </form>

    {#if busy}
      <ProgressPulse title={progressTitle} detail={progressDetail} ratio={coverRatio} />
    {/if}

    {#if error}
      <div class="status status--error" role="alert">
        <div>
          <p class="status__title">{error}</p>
          {#if errorKey && chatCipherErrorRetryable(errorKey)}
            <Button variant="ghost" size="sm" disabled={busy} onclick={redownloadTable}>{t(dict, 'tools.chatCipher.errorRetryTable')}</Button>
          {/if}
        </div>
      </div>
    {/if}
    {#if mode === 'encrypt' && (streamWaiting || result)}
      <ToolResult {dict} id="chat-cipher-out" label={t(dict, 'tools.chatCipher.coverOutput')} text={result} copy={streamDone}>
        {#snippet output()}
          <CoverStream target={result} waiting={streamWaiting && !result} labelledby="chat-cipher-out-label" on:done={onStreamDone} />
        {/snippet}
      </ToolResult>
    {:else if result}
      <ToolResult {dict} id="chat-cipher-out" label={t(dict, 'tools.chatCipher.plainOutput')} text={result} prose>
        {#if detectedLang}
          <p class="hint">{t(dict, 'tools.chatCipher.detectedLang').replace('{lang}', t(dict, `tools.chatCipher.lang.${detectedLang}`))}</p>
        {/if}
      </ToolResult>
    {/if}
  </Tabs>
</div>
