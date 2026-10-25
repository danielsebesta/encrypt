<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../../lib/t';
  import CopyButton from '../CopyButton.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import {
    chatCipherErrorKey,
    chatCipherErrorRetryable,
    decryptFromChat,
    encryptToChat,
    ensurePack,
    getLmRuntime,
    getPackStatus,
    isPackId,
    packList,
    packTotalBytes,
    PACKS,
    probeAccelerator,
    resetLanguagePack,
    type AcceleratorProbe,
    type ChatCipherErrorKey,
    type ChatCipherPhase,
    type LmRuntimeInfo,
    type PackId,
    type PackStatus,
  } from '../../lib/chatCipher';

  export let locale = 'en';
  export let dict: Record<string, string>;

  const models = packList();

  let mode: 'encrypt' | 'decrypt' = 'encrypt';
  let modelId: PackId = locale === 'cs' ? 'cs' : 'en';
  let inputText = '';
  let password = '';
  let result = '';
  let stream = '';
  let error = '';
  let errorKey: ChatCipherErrorKey | '' = '';
  let busy = false;
  let progressTitle = '';
  let progressDetail = '';
  let progressPct: number | null = null;
  let streamEl: HTMLElement | null = null;
  let pack: PackStatus = PACKS[modelId].bundled
    ? { state: 'bundled' }
    : { state: 'missing', bytes: packTotalBytes(PACKS[modelId]) };
  let accelProbe: AcceleratorProbe | null = null;
  let accelRuntime: LmRuntimeInfo | null = null;

  $: model = PACKS[modelId];
  $: modelBytes = packTotalBytes(model);
  $: accelText = formatAccel(accelProbe, accelRuntime);

  onMount(() => {
    void refreshPack(modelId);
    void refreshAccel();
  });

  async function refreshAccel() {
    try {
      accelProbe = await probeAccelerator();
      accelRuntime = await getLmRuntime(modelId);
    } catch {
      accelProbe = { status: 'unsupported', name: '' };
      accelRuntime = null;
    }
  }

  function formatAccel(probe: AcceleratorProbe | null, runtime: LmRuntimeInfo | null): string {
    if (runtime) {
      const kv = runtime.kv
        ? t(dict, 'tools.chatCipher.accel.kvOn')
        : t(dict, 'tools.chatCipher.accel.kvOff');
      if (runtime.device === 'webgpu') {
        const name = runtime.adapterName || 'WebGPU';
        return `${t(dict, 'tools.chatCipher.accel.runningWebgpu').replace('{name}', name)} · ${kv}`;
      }
      if (runtime.fallback === 'timeout') {
        return `${t(dict, 'tools.chatCipher.accel.fallbackTimeout')} · ${kv}`;
      }
      if (runtime.fallback === 'error') {
        return `${t(dict, 'tools.chatCipher.accel.fallbackError')} · ${kv}`;
      }
      return `${t(dict, 'tools.chatCipher.accel.runningWasm')} · ${kv}`;
    }
    if (!probe) return t(dict, 'tools.chatCipher.accel.checking');
    if (probe.status === 'ready') {
      return probe.name
        ? t(dict, 'tools.chatCipher.accel.ready').replace('{name}', probe.name)
        : t(dict, 'tools.chatCipher.accel.readyGeneric');
    }
    if (probe.status === 'no-adapter') return t(dict, 'tools.chatCipher.accel.noAdapter');
    return t(dict, 'tools.chatCipher.accel.unsupported');
  }

  async function refreshPack(next: PackId) {
    try {
      pack = await getPackStatus(next);
    } catch {
      pack = { state: 'missing', bytes: packTotalBytes(PACKS[next]) };
    }
  }

  function clearError() {
    error = '';
    errorKey = '';
  }

  function setModel(next: PackId) {
    if (next === modelId) return;
    modelId = next;
    result = '';
    stream = '';
    accelRuntime = null;
    clearError();
    void refreshPack(next);
    void getLmRuntime(next).then(info => {
      accelRuntime = info;
    });
  }

  function onModelSelect(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (isPackId(value)) setModel(value);
  }

  function formatParams(n: number): string {
    return n.toLocaleString(locale);
  }

  function showError(e: unknown, fallback: ChatCipherErrorKey = 'tools.chatCipher.errorGeneric') {
    errorKey = chatCipherErrorKey(e);
    if (errorKey === 'tools.chatCipher.errorGeneric' && fallback !== 'tools.chatCipher.errorGeneric') {
      errorKey = fallback;
    }
    error = t(dict, errorKey);
    const detail = e instanceof Error && e.message ? e.message : '';
    if (detail && typeof console !== 'undefined') console.error('[chat-cipher]', detail, e);
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function download() {
    clearError();
    try {
      await ensurePack(modelId, status => {
        pack = status;
      });
    } catch (e: unknown) {
      showError(e, 'tools.chatCipher.errorPack');
      pack = { state: 'error', message: error };
    }
  }

  async function redownloadPack() {
    clearError();
    result = '';
    stream = '';
    accelRuntime = null;
    try {
      await resetLanguagePack(modelId);
    } catch {
      /* still try a fresh download */
    }
    pack = { state: 'missing', bytes: packTotalBytes(PACKS[modelId]) };
    await download();
  }

  function setProgress(
    phase: ChatCipherPhase,
    info?: { done?: number; total?: number; preview?: string; backend?: 'webgpu' | 'wasm' },
  ) {
    const pct =
      info && info.total && info.total > 0 && typeof info.done === 'number'
        ? Math.min(100, Math.round((100 * info.done) / info.total))
        : null;
    progressPct = phase === 'cover' ? pct : null;
    if (phase === 'seal') {
      progressTitle = t(dict, 'tools.chatCipher.progress.sealTitle');
      progressDetail = t(dict, 'tools.chatCipher.progress.sealDetail');
      stream = '';
    } else if (phase === 'loadModel') {
      progressTitle = t(dict, 'tools.chatCipher.progress.loadTitle');
      progressDetail =
        info?.backend === 'webgpu'
          ? t(dict, 'tools.chatCipher.progress.loadWebgpu')
          : info?.backend === 'wasm'
            ? t(dict, 'tools.chatCipher.progress.loadWasm')
            : t(dict, 'tools.chatCipher.progress.loadDetail');
      stream = '';
    } else if (phase === 'cover') {
      progressTitle =
        mode === 'encrypt'
          ? t(dict, 'tools.chatCipher.progress.writeTitle')
          : t(dict, 'tools.chatCipher.progress.readTitle');
      progressDetail =
        pct == null
          ? t(dict, 'tools.chatCipher.progress.coverDetail')
          : t(dict, 'tools.chatCipher.progress.coverPct').replace('{pct}', String(pct));
      if (mode === 'encrypt' && typeof info?.preview === 'string') {
        stream = info.preview;
        void tick().then(() => {
          if (streamEl) streamEl.scrollTop = streamEl.scrollHeight;
        });
      }
    } else if (phase === 'open') {
      progressTitle = t(dict, 'tools.chatCipher.progress.openTitle');
      progressDetail = t(dict, 'tools.chatCipher.progress.openDetail');
      stream = '';
    }
  }

  async function handleProcess() {
    clearError();
    result = '';
    stream = '';
    progressPct = null;
    if (!inputText || !password) {
      errorKey = 'tools.chatCipher.errorBoth';
      error = t(dict, errorKey);
      return;
    }
    if (pack.state !== 'bundled' && pack.state !== 'ready') {
      errorKey = 'tools.chatCipher.errorNeedPack';
      error = t(dict, errorKey);
      return;
    }
    busy = true;
    progressTitle = t(dict, 'tools.chatCipher.progress.startingTitle');
    progressDetail = t(dict, 'tools.chatCipher.progress.startingDetail');
    try {
      result =
        mode === 'encrypt'
          ? await encryptToChat(inputText, password, modelId, setProgress)
          : await decryptFromChat(inputText, password, modelId, setProgress);
      stream = '';
      accelRuntime = await getLmRuntime(modelId);
    } catch (e: unknown) {
      showError(e);
      accelRuntime = await getLmRuntime(modelId);
    } finally {
      busy = false;
      progressTitle = '';
      progressDetail = '';
      progressPct = null;
    }
  }

  function toggleMode() {
    mode = mode === 'encrypt' ? 'decrypt' : 'encrypt';
    inputText = '';
    result = '';
    stream = '';
    clearError();
  }
</script>

<div class="stack">
  <div class="tabs" role="tablist" aria-label={t(dict, 'tools.chatCipher.h1')}>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'encrypt'} aria-controls="chat-cipher-panel" on:click={() => { if (mode !== 'encrypt') toggleMode(); }}>{t(dict, 'tools.chatCipher.encrypt')}</button>
    <button type="button" role="tab" class="tab" aria-selected={mode === 'decrypt'} aria-controls="chat-cipher-panel" on:click={() => { if (mode !== 'decrypt') toggleMode(); }}>{t(dict, 'tools.chatCipher.decrypt')}</button>
  </div>

  <div id="chat-cipher-panel" role="tabpanel" class="stack">
    <div class="field">
      <label for="chat-cipher-model" class="label">{t(dict, 'tools.chatCipher.model.label')}</label>
      <select
        id="chat-cipher-model"
        class="input"
        value={modelId}
        disabled={busy}
        on:change={onModelSelect}
      >
        {#each models as m}
          <option value={m.id}>
            {m.flag} {m.name} · {m.languageName} · {formatBytes(packTotalBytes(m))}
          </option>
        {/each}
      </select>
      <div class="model-card" aria-live="polite">
        <div class="model-card__head">
          <span class="model-card__flag" aria-hidden="true">{model.flag}</span>
          <div class="min-w-0">
            <p class="model-card__title">{model.label}</p>
            <p class="model-card__sub">{model.architecture} · {model.parameters} · {model.quantization}</p>
          </div>
        </div>
        <dl class="model-card__grid">
          <div>
            <dt>{t(dict, 'tools.chatCipher.model.language')}</dt>
            <dd>{model.flag} {t(dict, `tools.chatCipher.lang.${model.language}`)}</dd>
          </div>
          <div>
            <dt>{t(dict, 'tools.chatCipher.model.size')}</dt>
            <dd>{formatBytes(modelBytes)}</dd>
          </div>
          <div>
            <dt>{t(dict, 'tools.chatCipher.model.parameters')}</dt>
            <dd>{model.parameters}</dd>
          </div>
          <div>
            <dt>{t(dict, 'tools.chatCipher.model.context')}</dt>
            <dd>{formatParams(model.context)}</dd>
          </div>
          <div>
            <dt>{t(dict, 'tools.chatCipher.model.layers')}</dt>
            <dd>{model.layers} × {formatParams(model.hiddenSize)}</dd>
          </div>
          <div>
            <dt>{t(dict, 'tools.chatCipher.model.vocab')}</dt>
            <dd>{formatParams(model.vocabSize)}</dd>
          </div>
          <div>
            <dt>{t(dict, 'tools.chatCipher.model.author')}</dt>
            <dd>{model.author}</dd>
          </div>
          <div>
            <dt>{t(dict, 'tools.chatCipher.model.source')}</dt>
            <dd>{model.source}</dd>
          </div>
          <div class="model-card__wide">
            <dt>{t(dict, 'tools.chatCipher.model.upstream')}</dt>
            <dd>{model.upstream}</dd>
          </div>
          <div class="model-card__wide">
            <dt>{t(dict, 'tools.chatCipher.model.license')}</dt>
            <dd>{model.license}</dd>
          </div>
          <div class="model-card__wide">
            <dt>{t(dict, 'tools.chatCipher.accel.label')}</dt>
            <dd
              class:accel--gpu={accelRuntime?.device === 'webgpu' || (!accelRuntime && accelProbe?.status === 'ready')}
              class:accel--cpu={accelRuntime?.device === 'wasm' || (!!accelProbe && accelProbe.status !== 'ready' && !accelRuntime)}
            >{accelText}</dd>
          </div>
        </dl>
      </div>
    </div>

    <div class="field">
      {#if pack.state === 'bundled'}
        <p class="status">{t(dict, 'tools.chatCipher.pack.bundled')}</p>
      {:else if pack.state === 'ready'}
        <p class="status">{t(dict, 'tools.chatCipher.pack.ready')}</p>
      {:else if pack.state === 'downloading'}
        <p class="status status--busy" role="status">{t(dict, 'tools.chatCipher.pack.downloading').replace('{received}', formatBytes(pack.received)).replace('{total}', formatBytes(pack.total))}</p>
      {:else if pack.state === 'error'}
        <p class="status status--error" role="alert">{pack.message}</p>
        <button type="button" class="btn" on:click={download}>{t(dict, 'tools.chatCipher.pack.retry')}</button>
      {:else}
        <p class="status">{t(dict, 'tools.chatCipher.pack.missing').replace('{size}', formatBytes(pack.bytes || modelBytes))}</p>
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

    <button type="button" class="btn w-full" disabled={busy || (pack.state !== 'bundled' && pack.state !== 'ready')} on:click={handleProcess}>
      {#if busy}
        {t(dict, 'tools.chatCipher.progress.workingBtn')}
      {:else}
        {mode === 'encrypt' ? t(dict, 'tools.chatCipher.encryptBtn') : t(dict, 'tools.chatCipher.decryptBtn')}
      {/if}
    </button>

    {#if busy && !(mode === 'encrypt' && stream)}
      <ProgressPulse title={progressTitle} detail={progressDetail} />
    {/if}

    {#if busy && mode === 'encrypt' && (stream || progressPct != null)}
      <div class="field cipher-live" aria-live="polite" aria-busy="true">
        <div class="output-head">
          <span class="label">{progressTitle || t(dict, 'tools.chatCipher.progress.writeTitle')}</span>
          {#if progressPct != null}
            <span class="cipher-live__pct">{progressPct}%</span>
          {/if}
        </div>
        {#if progressPct != null}
          <div class="cipher-live__meter" aria-hidden="true">
            <div class="cipher-live__meter-fill" style={`width:${progressPct}%`}></div>
          </div>
        {/if}
        <p class="status__detail cipher-live__hint">{progressDetail}</p>
        <div class="output output--ok cipher-live__stream" bind:this={streamEl}>
          {stream}<span class="cipher-live__caret" aria-hidden="true"></span>
        </div>
      </div>
    {/if}

    {#if error}
      <div class="status status--error" role="alert">
        <div>
          <p class="status__title">{error}</p>
          {#if errorKey && chatCipherErrorRetryable(errorKey)}
            <p class="status__detail">{t(dict, 'tools.chatCipher.errorRetryHint')}</p>
            <button type="button" class="btn-ghost btn-sm" on:click={redownloadPack}>
              {t(dict, 'tools.chatCipher.errorRetryPack')}
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
  .model-card {
    margin-top: 0.75rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.75rem;
    background: var(--surface);
    padding: 0.9rem 1rem;
  }

  .model-card__head {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 0.85rem;
  }

  .model-card__flag {
    font-size: 1.6rem;
    line-height: 1;
  }

  .model-card__title {
    margin: 0;
    font-weight: 700;
    color: var(--text);
  }

  .model-card__sub {
    margin: 0.15rem 0 0;
    font-size: 0.875rem;
    color: var(--muted);
  }

  .model-card__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem 1rem;
    margin: 0;
  }

  .model-card__grid dt {
    margin: 0;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .model-card__grid dd {
    margin: 0.1rem 0 0;
    font-size: 0.9rem;
    color: var(--text);
    overflow-wrap: anywhere;
  }

  .model-card__wide {
    grid-column: 1 / -1;
  }

  .accel--gpu {
    color: var(--accent-strong);
  }

  .accel--cpu {
    color: var(--warn);
  }

  @media (max-width: 420px) {
    .model-card__grid {
      grid-template-columns: 1fr;
    }
  }

  .cipher-live__pct {
    font-variant-numeric: tabular-nums;
    color: var(--accent-strong);
    font-weight: 700;
    font-size: 0.875rem;
  }

  .cipher-live__meter {
    height: 0.35rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    overflow: hidden;
  }

  .cipher-live__meter-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 120ms linear;
  }

  .cipher-live__hint {
    margin: 0;
  }

  .cipher-live__stream {
    max-height: 16rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .cipher-live__caret {
    display: inline-block;
    width: 0.55ch;
    height: 1.05em;
    margin-left: 1px;
    vertical-align: text-bottom;
    background: var(--accent);
    animation: cipher-caret 1s steps(1) infinite;
  }

  :global(.cipher-cover) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  @keyframes cipher-caret {
    50% {
      opacity: 0;
    }
  }
</style>
