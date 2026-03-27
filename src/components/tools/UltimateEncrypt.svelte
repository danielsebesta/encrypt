<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { encrypt, decrypt } from '../../lib/crypto';
  import { encryptData } from '../../lib/ghost/crypto';
  import { createStegoImage } from '../../lib/ghost/steganography';
  import { prepareSendUpload } from '../../lib/nologSend';
  import CopyButton from '../CopyButton.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  type Step = 'input' | 'processing' | 'result';
  type DeliveryMode = 'auto' | 'link' | 'ghost';
  type ShortProvider = 'nolog' | 'dagd' | 'ulvis' | 'kratky' | 'spoome' | 'cleanuri' | 'isgd' | '1url';

  let step: Step = 'input';

  let textInput = '';
  let file: File | null = null;
  let password = '';
  let autoPassword = true;
  let enableStego = false;
  let enableTimelock = false;
  let timelockDate = '';
  let showAdvanced = false;
  let showQr = false;

  let resultUrl = '';
  let shortUrl = '';
  let stegoImageUrl = '';
  let stegoImageBlob: Blob | null = null;
  let error = '';
  let progressTitle = '';
  let progressDetail = '';
  let debugLog: string[] = [];
  let qrSvg = '';

  const INLINE_LIMIT = 10 * 1024;
  const MAX_FILE = 50 * 1024 * 1024;
  const STEGO_THRESHOLD = 500 * 1024;

  interface HostInfo { id: string; name: string; retention: string; maxBytes: number; }

  // Send network is preferred — E2E encrypted, multiple instances
  const SEND_HOST: HostInfo = { id: 'nologsend', name: 'Send network', retention: '7+ days', maxBytes: 5 * 1024 * 1024 * 1024 };

  // Fallback binary hosts (shuffled at upload time)
  const BINARY_HOSTS: HostInfo[] = [
    { id: 'quax', name: 'qu.ax', retention: '30 days', maxBytes: 256 * 1024 * 1024 },
    { id: 'x0at', name: 'x0.at', retention: '3-100 days', maxBytes: 512 * 1024 * 1024 },
    { id: 'catbox', name: 'Catbox.moe', retention: 'forever', maxBytes: 200 * 1024 * 1024 },
    { id: 'tmpfile', name: 'tmpfile.link', retention: '7 days', maxBytes: 100 * 1024 * 1024 },
    { id: 'litterbox', name: 'Litterbox', retention: '3 days', maxBytes: 1024 * 1024 * 1024 },
    { id: 'tempsh', name: 'temp.sh', retention: '3 days', maxBytes: 4 * 1024 * 1024 * 1024 },
    { id: 'uguu', name: 'Uguu.se', retention: '3 hours', maxBytes: 128 * 1024 * 1024 },
  ];

  // Image hosts for stego PNGs (shuffled at upload time)
  const IMAGE_HOSTS: HostInfo[] = [
    { id: 'sxcu', name: 'sxcu.net', retention: 'forever', maxBytes: 95 * 1024 * 1024 },
    { id: 'freeimage', name: 'FreeImage.host', retention: 'forever', maxBytes: 64 * 1024 * 1024 },
    { id: 'imgbb', name: 'ImgBB', retention: 'forever', maxBytes: 32 * 1024 * 1024 },
  ];

  function shuffleArr<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  $: payloadSize = file ? file.size : new TextEncoder().encode(textInput.trim()).byteLength;
  $: isLarge = payloadSize > INLINE_LIMIT;
  $: deliveryMode = isLarge ? 'ghost' : 'link';
  $: shareUrl = shortUrl || resultUrl;
  $: if (step === 'result' && shareUrl) {
    void generateQr(shareUrl);
  }


  function generatePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const arr = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(arr, b => chars[b % chars.length]).join('');
  }

  let dragging = false;
  let dropZoneEl: HTMLElement;
  let fileInputEl: HTMLInputElement;

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    file = target.files?.[0] ?? null;
    if (file) textInput = '';
  }

  function clearFile() {
    file = null;
    if (fileInputEl) fileInputEl.value = '';
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) { file = f; textInput = ''; }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = true;
  }

  function handleDragLeave() {
    dragging = false;
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        e.preventDefault();
        const f = item.getAsFile();
        if (f) { file = f; textInput = ''; }
        return;
      }
    }
  }

  function setProgress(title: string, detail = '') {
    progressTitle = title;
    progressDetail = detail;
  }

  function pushDebug(message: string) {
    const line = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${message}`;
    debugLog = [...debugLog, line];
  }

  function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function buildReceiveUrls(encoded: string) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';
    return {
      direct: `${origin}/u/#${encoded}`,
      shortenable: `${origin}/u/?p=${encoded}`,
    };
  }

  async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function generateQr(url: string) {
    try {
      qrSvg = await QRCode.toString(url, {
        type: 'svg',
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 320,
        color: {
          dark: '#065f46',
          light: '#ffffff',
        },
      });
    } catch (e: any) {
      pushDebug(`QR generation failed: ${e?.message || 'unknown error'}`);
      qrSvg = '';
    }
  }

  async function handleEncrypt() {
    error = '';
    resultUrl = '';
    shortUrl = '';
    stegoImageUrl = '';
    stegoImageBlob = null;
    setProgress('', '');
    debugLog = [];

    const trimmed = textInput.trim();
    pushDebug(`Start encrypt: mode=${deliveryMode}, file=${file ? file.name : 'none'}, payloadSize=${payloadSize} bytes`);
    if (!file && !trimmed) {
      error = t(dict, 'tools.ultimateEncrypt.errorEnterMessageOrFile');
      pushDebug('Validation failed: empty input');
      return;
    }
    if (file && file.size > MAX_FILE) {
      error = t(dict, 'tools.ultimateEncrypt.errorFileTooLarge').replace('{size}', String(Math.round(MAX_FILE / (1024 * 1024))));
      pushDebug(`Validation failed: file too large (${file.size} bytes)`);
      return;
    }

    if (autoPassword) {
      password = generatePassword();
      pushDebug('Password auto-generated');
    }
    if (!password) {
      error = t(dict, 'tools.ultimateEncrypt.errorPasswordRequired');
      pushDebug('Validation failed: missing password');
      return;
    }

    step = 'processing';

    try {
      if (deliveryMode === 'link') {
        await encryptInline();
      } else {
        await encryptGhost();
      }
      step = 'result';
    } catch (e: any) {
      error = e?.message || t(dict, 'tools.ultimateEncrypt.errorEncryptionFailed');
      pushDebug(`Encrypt failed: ${error}`);
      step = 'input';
    }
  }

  async function encryptInline() {
    setProgress(t(dict, 'tools.ultimateEncrypt.progressPreparingTitle'), t(dict, 'tools.ultimateEncrypt.progressPreparingDetail'));
    let payload: any;
    if (file) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const b64 = btoa(String.fromCharCode(...bytes));
      payload = { v: 1, mode: 'inline', kind: 'file', name: file.name, type: file.type || 'application/octet-stream', data: b64 };
      pushDebug(`Inline payload prepared for file ${file.name} (${bytes.byteLength} bytes)`);
    } else {
      payload = { v: 1, mode: 'inline', kind: 'text', text: textInput.trim() };
      pushDebug(`Inline payload prepared for text (${textInput.trim().length} chars)`);
    }

    setProgress(t(dict, 'tools.ultimateEncrypt.progressEncryptingTitle'), t(dict, 'tools.ultimateEncrypt.progressEncryptingDetail'));
    const json = JSON.stringify(payload);
    const jsonBytes = new TextEncoder().encode(json);
    const compressed = await gzipBytes(jsonBytes);
    const compressedB64 = bytesToBase64(compressed);
    pushDebug(`Inline payload compressed from ${jsonBytes.byteLength} to ${compressed.byteLength} bytes`);
    const encrypted = await encrypt(compressedB64, password);
    const encoded = base64UrlEncode(encrypted);
    pushDebug(`Inline payload encrypted (${encrypted.byteLength} bytes, encoded length ${encoded.length})`);

    const urls = buildReceiveUrls(encoded);
    resultUrl = urls.direct;
    setProgress(t(dict, 'tools.ultimateEncrypt.progressLinkTitle'), t(dict, 'tools.ultimateEncrypt.progressLinkDetail'));
    await autoShorten(urls.shortenable);

    if (enableStego) {
      await wrapInStego(shortUrl || resultUrl);
    }
  }

  async function encryptGhost() {
    setProgress(t(dict, 'tools.ultimateEncrypt.progressReadingTitle'), t(dict, 'tools.ultimateEncrypt.progressReadingDetail'));
    let buffer: Uint8Array;
    let filename: string;

    if (file) {
      buffer = new Uint8Array(await file.arrayBuffer());
      filename = file.name;
      pushDebug(`Read file ${filename} (${buffer.byteLength} bytes)`);
    } else {
      buffer = new TextEncoder().encode(textInput.trim());
      filename = 'message.txt';
      pushDebug(`Prepared text payload as ${filename} (${buffer.byteLength} bytes)`);
    }

    setProgress(t(dict, 'tools.ultimateEncrypt.progressEncryptingTitle'), t(dict, 'tools.ultimateEncrypt.progressEncryptingUploadDetail'));
    const encrypted = await encryptData(buffer, password, filename);
    pushDebug(`Inner ghost payload encrypted (${encrypted.byteLength} bytes)`);

    let uploadBytes: Uint8Array;
    let uploadFilename: string;
    let usedStego = false;

    if (encrypted.length <= STEGO_THRESHOLD) {
      setProgress(t(dict, 'tools.ultimateEncrypt.progressHiddenPackageTitle'), t(dict, 'tools.ultimateEncrypt.progressHiddenPackageDetail'));
      uploadBytes = await createStegoImage(encrypted);
      uploadFilename = 'ghost.png';
      usedStego = true;
      pushDebug(`Stego wrapper created (${uploadBytes.byteLength} bytes PNG)`);
    } else {
      uploadBytes = encrypted;
      uploadFilename = 'ghost.bin';
      pushDebug(`Using raw binary upload (${uploadBytes.byteLength} bytes)`);
    }

    // Build upload chain: stego → shuffled image hosts, binary → Send first + shuffled file hosts
    let eligible: HostInfo[];
    if (usedStego) {
      eligible = shuffleArr(IMAGE_HOSTS).filter(h => uploadBytes.length <= h.maxBytes);
    } else {
      const sendEligible = uploadBytes.length <= SEND_HOST.maxBytes ? [SEND_HOST] : [];
      const fileEligible = shuffleArr(BINARY_HOSTS).filter(h => uploadBytes.length <= h.maxBytes);
      eligible = [...sendEligible, ...fileEligible];
    }
    pushDebug(`Eligible upload hosts: ${eligible.map(h => h.name).join(', ') || 'none'}`);

    let uploadUrl = '';

    let sendPrepared: Awaited<ReturnType<typeof prepareSendUpload>> | null = null;

    for (const host of eligible) {
      setProgress(t(dict, 'tools.ultimateEncrypt.progressSendingTitle'), t(dict, 'tools.ultimateEncrypt.progressSendingDetail'));
      try {
        pushDebug(`Trying host ${host.name} (${host.id})`);

        let fetchBody: Uint8Array = uploadBytes;
        const headers: Record<string, string> = {};

        if (host.id === 'nologsend') {
          if (!sendPrepared) {
            pushDebug('Preparing Send ECE encryption client-side...');
            sendPrepared = await prepareSendUpload(uploadBytes, uploadFilename, uploadFilename.endsWith('.png') ? 'image/png' : 'application/octet-stream');
            pushDebug(`Send ECE encrypted (${sendPrepared.encryptedBytes.byteLength} bytes)`);
          }
          fetchBody = sendPrepared.encryptedBytes;
          headers['X-Send-Metadata'] = sendPrepared.metadataB64;
          headers['X-Send-Auth'] = sendPrepared.authHeader;
          headers['X-Send-Secret'] = sendPrepared.secretB64;
        }

        const res = await fetch(`/api/ghost/upload?services=${host.id}&stego=${usedStego}&filename=${encodeURIComponent(uploadFilename)}`, {
          method: 'POST',
          body: fetchBody,
          headers,
        });
        pushDebug(`Host ${host.name} responded with HTTP ${res.status}`);
        const rawBody = await res.text();
        let data: any = null;
        try {
          data = rawBody ? JSON.parse(rawBody) : null;
        } catch {
          data = null;
        }
        if (!res.ok) {
          const apiError = data?.error || data?.results?.[0]?.error;
          if (apiError) pushDebug(`Host ${host.name} error: ${apiError}`);
          if (Array.isArray(data?.results?.[0]?.details)) {
            for (const detail of data.results[0].details) pushDebug(`Host ${host.name} detail: ${detail}`);
          }
          if (!apiError && rawBody) {
            const snippet = rawBody.replace(/\s+/g, ' ').trim().slice(0, 220);
            pushDebug(`Host ${host.name} raw response: ${snippet}`);
          }
          continue;
        }
        const result = data?.results?.[0];
        if (result?.url) {
          uploadUrl = result.url;
          pushDebug(`Host ${host.name} returned URL ${uploadUrl}`);
          break;
        }
        if (result?.error) pushDebug(`Host ${host.name} error: ${result.error}`);
        if (Array.isArray(result?.details)) {
          for (const detail of result.details) pushDebug(`Host ${host.name} detail: ${detail}`);
        }
        if (!result && rawBody) {
          const snippet = rawBody.replace(/\s+/g, ' ').trim().slice(0, 220);
          pushDebug(`Host ${host.name} raw response: ${snippet}`);
        }
        pushDebug(`Host ${host.name} returned no usable URL in response body`);
      } catch (e: any) {
        pushDebug(`Host ${host.name} failed: ${e?.message || 'unknown error'}`);
      }
    }

    if (!uploadUrl) {
      throw new Error(t(dict, 'tools.ultimateEncrypt.errorAllUploadHostsFailed'));
    }

    const ghostPayload = {
      v: 1,
      mode: 'ghost',
      url: uploadUrl,
      stego: usedStego,
    };

    setProgress(t(dict, 'tools.ultimateEncrypt.progressLinkTitle'), t(dict, 'tools.ultimateEncrypt.progressFinalLinkDetail'));
    const payloadJson = JSON.stringify(ghostPayload);
    const payloadBytes = new TextEncoder().encode(payloadJson);
    const compressed = await gzipBytes(payloadBytes);
    const compressedB64 = bytesToBase64(compressed);
    pushDebug(`Outer ghost payload compressed from ${payloadBytes.byteLength} to ${compressed.byteLength} bytes`);
    const encPayload = await encrypt(compressedB64, password);
    const encoded = base64UrlEncode(encPayload);
    pushDebug(`Final link payload encrypted (${encPayload.byteLength} bytes, encoded length ${encoded.length})`);

    const urls = buildReceiveUrls(encoded);
    resultUrl = urls.direct;
    await autoShorten(urls.shortenable);

    if (enableStego) {
      await wrapInStego(shortUrl || resultUrl);
    }
  }

  async function wrapInStego(url: string) {
    setProgress(t(dict, 'tools.ultimateEncrypt.progressCoverImageTitle'), t(dict, 'tools.ultimateEncrypt.progressCoverImageDetail'));
    const urlBytes = new TextEncoder().encode(url);
    const stegoBytes = await createStegoImage(urlBytes);
    pushDebug(`Generated downloadable PNG wrapper (${stegoBytes.byteLength} bytes)`);
    stegoImageBlob = new Blob([stegoBytes], { type: 'image/png' });
    stegoImageUrl = URL.createObjectURL(stegoImageBlob);
  }

  // PRIMARY: privacy-first (no tracking, no logs) — shuffled to spread load
  const PRIMARY_SHORT: ShortProvider[] = ['nolog', 'dagd', 'ulvis', 'kratky'];
  // FALLBACK: when primary fails (some tracking, but stable) — shuffled
  const FALLBACK_SHORT: ShortProvider[] = ['spoome', 'cleanuri', 'isgd', '1url'];

  const SHORT_NAMES: Record<ShortProvider, string> = {
    nolog: 'Nolog.link', dagd: 'da.gd', ulvis: 'ulvis.net', kratky: 'kratky.link',
    spoome: 'spoo.me', cleanuri: 'CleanURI', isgd: 'is.gd', '1url': '1url.cz',
  };

  const SHORTEN_TIMEOUT = 3000;

  async function tryShorten(url: string, provider: ShortProvider): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SHORTEN_TIMEOUT);
    try {
      pushDebug(`Shortener ${SHORT_NAMES[provider]}: request start`);
      const res = await fetch('/api/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, provider }),
        signal: controller.signal,
      });
      const data = await res.json();
      pushDebug(`Shortener ${SHORT_NAMES[provider]}: HTTP ${res.status}`);
      if (res.ok && data?.shorturl) {
        pushDebug(`Shortener ${SHORT_NAMES[provider]}: success -> ${data.shorturl}`);
        return data.shorturl;
      }
      if (data?.error) pushDebug(`Shortener ${SHORT_NAMES[provider]}: ${data.error}`);
    } catch (e: any) {
      pushDebug(`Shortener ${SHORT_NAMES[provider]}: ${e?.name === 'AbortError' ? 'timeout' : e?.message || 'failed'}`);
    } finally {
      clearTimeout(timer);
    }
    return null;
  }

  async function autoShorten(url: string): Promise<void> {
    setProgress(t(dict, 'tools.ultimateEncrypt.progressShortenTitle'), t(dict, 'tools.ultimateEncrypt.progressShortenDetail'));
    // Shuffle within tiers to spread load across providers
    for (const provider of shuffleArr(PRIMARY_SHORT)) {
      const result = await tryShorten(url, provider);
      if (result) { shortUrl = result; return; }
      const retry = await tryShorten(url, provider);
      if (retry) { shortUrl = retry; return; }
    }
    for (const provider of shuffleArr(FALLBACK_SHORT)) {
      const result = await tryShorten(url, provider);
      if (result) { shortUrl = result; return; }
    }
  }

  function downloadStego() {
    if (!stegoImageUrl) return;
    const a = document.createElement('a');
    a.href = stegoImageUrl;
    a.download = 'secret.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function reset() {
    step = 'input';
    textInput = '';
    file = null;
    password = '';
    autoPassword = true;
    enableStego = false;
    enableTimelock = false;
    timelockDate = '';
    resultUrl = '';
    shortUrl = '';
    error = '';
    showAdvanced = false;
    showQr = false;
    setProgress('', '');
    if (stegoImageUrl) URL.revokeObjectURL(stegoImageUrl);
    stegoImageUrl = '';
    stegoImageBlob = null;
    qrSvg = '';
    debugLog = [];
  }

  onMount(() => {});
</script>

<div class="space-y-6 text-left">
  {#if step === 'input'}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="space-y-4" on:paste={handlePaste}>
      <!-- Side-by-side input: text left, file right -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <!-- Text input -->
        <div class="ue-input-pane" class:ue-input-pane--active={!file && textInput.trim().length > 0} class:ue-input-pane--disabled={!!file}>
          <label class="ue-input-pane__label" for="ue-text">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            {t(dict, 'tools.ultimateEncrypt.messageLabel')}
          </label>
          <textarea
            id="ue-text"
            class="ue-textarea"
            bind:value={textInput}
            placeholder={t(dict, 'tools.ultimateEncrypt.messagePlaceholder')}
            disabled={!!file}
          ></textarea>
        </div>

        <!-- File drop zone -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="ue-input-pane ue-drop-zone"
          class:ue-input-pane--active={!!file}
          class:ue-drop-zone--dragging={dragging}
          bind:this={dropZoneEl}
          on:drop={handleDrop}
          on:dragover={handleDragOver}
          on:dragleave={handleDragLeave}
        >
          {#if file}
            <div class="flex flex-col items-center gap-2 text-center py-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <span class="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate max-w-full px-2">{file.name}</span>
              <span class="text-[10px] text-zinc-400">{file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}</span>
              <button type="button" class="text-[10px] font-bold text-red-500 hover:underline mt-1" on:click={clearFile}>{t(dict, 'tools.ultimateEncrypt.remove')}</button>
            </div>
          {:else}
            <label class="flex flex-col items-center gap-2 cursor-pointer text-center py-2 w-full h-full justify-center" for="ue-file">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-400 dark:text-zinc-500"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span class="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.ultimateEncrypt.fileLabel')}</span>
              <span class="text-[10px] text-zinc-400 dark:text-zinc-500">Drop, paste, or click</span>
            </label>
            <input id="ue-file" type="file" class="sr-only" bind:this={fileInputEl} on:change={handleFileChange} />
          {/if}
        </div>
      </div>

      <!-- Password -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="label block" for="ue-pass">{t(dict, 'tools.ultimateEncrypt.passwordLabel')}</label>
          <label class="inline-flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" bind:checked={autoPassword} class="accent-emerald-500" />
            {t(dict, 'tools.ultimateEncrypt.autoGenerate')}
          </label>
        </div>
        {#if autoPassword}
          <p class="text-[10px] text-zinc-400 italic">{t(dict, 'tools.ultimateEncrypt.autoGenerateHint')}</p>
        {:else}
          <input
            id="ue-pass"
            type="password"
            class="input"
            bind:value={password}
            autocomplete="new-password"
            placeholder={t(dict, 'tools.ultimateEncrypt.passwordPlaceholder')}
          />
        {/if}
      </div>

      <!-- Advanced -->
      <details class="text-xs" bind:open={showAdvanced}>
        <summary class="cursor-pointer select-none text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 font-bold uppercase tracking-widest text-[10px]">{t(dict, 'tools.ultimateEncrypt.advancedOptions')}</summary>
        <div class="mt-3 space-y-3 pl-1">
          <label class="flex items-center gap-2 cursor-pointer select-none text-zinc-500 dark:text-zinc-400">
            <input type="checkbox" bind:checked={enableStego} class="accent-emerald-500" />
            <span>{t(dict, 'tools.ultimateEncrypt.hideInImage')}</span>
          </label>
        </div>
      </details>

      {#if error}
        <p class="text-xs text-red-500">{error}</p>
      {/if}

      <button
        class="btn w-full"
        type="button"
        on:click={handleEncrypt}
        disabled={(!textInput.trim() && !file)}
      >
        {t(dict, 'tools.ultimateEncrypt.encryptAndShare')}
      </button>
    </div>

  {:else if step === 'processing'}
    <div class="space-y-4">
      <ProgressPulse title={progressTitle || t(dict, 'tools.ultimateEncrypt.progressDefaultTitle')} detail={progressDetail || t(dict, 'tools.ultimateEncrypt.progressDefaultDetail')} />
      {#if error}
        <p class="text-xs text-red-500">{error}</p>
      {/if}
    </div>

  {:else if step === 'result'}
    <div class="space-y-5">
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="label block">{shortUrl ? t(dict, 'tools.ultimateEncrypt.shareThisLink') : t(dict, 'tools.ultimateEncrypt.encryptedLink')}</label>
          <div class="flex items-center gap-2">
            {#if qrSvg && shareUrl}
              <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                aria-label={t(dict, 'tools.ultimateEncrypt.qrAlt')}
                title={t(dict, 'tools.ultimateEncrypt.qrAlt')}
                on:click={() => showQr = !showQr}
              >
                <svg viewBox="0 0 24 24" class="h-4.5 w-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 4h6v6H4z" />
                  <path d="M14 4h6v6h-6z" />
                  <path d="M4 14h6v6H4z" />
                  <path d="M14 14h2" />
                  <path d="M18 14h2v2" />
                  <path d="M14 18h2v2h-2z" />
                  <path d="M18 18h2v2h-2z" />
                </svg>
              </button>
            {/if}
            <CopyButton text={shortUrl || resultUrl} label={t(dict, 'tools.ultimateEncrypt.copy')} />
          </div>
        </div>
        <input class="input text-xs font-mono" type="text" readonly value={shortUrl || resultUrl} />
        {#if showQr && qrSvg && shareUrl}
          <div class="mt-3 flex justify-center">
            <div class="w-full max-w-[248px] rounded-[1.8rem] border border-emerald-200/80 dark:border-emerald-900/70 bg-[linear-gradient(180deg,rgba(236,253,245,0.98),rgba(209,250,229,0.92))] dark:bg-[linear-gradient(180deg,rgba(2,44,34,0.96),rgba(4,28,24,0.98))] p-3 shadow-[0_18px_60px_rgba(6,95,70,0.18)]">
              <div class="relative overflow-hidden rounded-[1.35rem] border border-white/70 dark:border-white/8 bg-white p-3">
                <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.10),transparent_58%)]"></div>
                <div class="relative mx-auto w-full max-w-[200px]" aria-label={t(dict, 'tools.ultimateEncrypt.qrAlt')}>
                  <div class="block w-full [&>svg]:block [&>svg]:h-auto [&>svg]:w-full [&>svg]:rounded-[1rem]">
                    {@html qrSvg}
                  </div>
                  <div class="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[0.95rem] border border-emerald-200 bg-white shadow-[0_10px_30px_rgba(6,95,70,0.16)]">
                    <svg viewBox="0 0 24 24" class="h-5 w-5 text-emerald-700" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M4 4h6v6H4z" />
                      <path d="M14 4h6v6h-6z" />
                      <path d="M4 14h6v6H4z" />
                      <path d="M14 14h2" />
                      <path d="M18 14h2v2" />
                      <path d="M14 18h2v2h-2z" />
                      <path d="M18 18h2v2h-2z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        {/if}
        {#if shortUrl}
          <details class="text-[11px] text-zinc-400">
            <summary class="cursor-pointer select-none hover:text-zinc-600 dark:hover:text-zinc-300">{t(dict, 'tools.ultimateEncrypt.fullLink')}</summary>
            <div class="mt-1 flex items-center gap-2">
              <input class="input text-[10px] font-mono flex-1" type="text" readonly value={resultUrl} />
              <CopyButton text={resultUrl} label={t(dict, 'tools.ultimateEncrypt.copy')} className="!text-[9px]" />
            </div>
          </details>
        {/if}
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="label block">{t(dict, 'tools.ultimateEncrypt.passwordLabel')}</label>
          <CopyButton text={password} label={t(dict, 'tools.ultimateEncrypt.copy')} />
        </div>
        <input class="input text-xs font-mono" type="text" readonly value={password} />
        <p class="text-[10px] text-amber-500">{t(dict, 'tools.ultimateEncrypt.passwordWarning')}</p>
      </div>

      {#if stegoImageUrl}
        <div class="space-y-2">
          <label class="label block">{t(dict, 'tools.ultimateEncrypt.steganographyImage')}</label>
          <p class="text-[11px] text-zinc-400">{t(dict, 'tools.ultimateEncrypt.steganographyHelp')}</p>
          <div class="flex items-center gap-3">
            <img src={stegoImageUrl} alt="" class="w-16 h-16 rounded border border-zinc-200 dark:border-zinc-800 object-cover" />
            <button type="button" class="btn-outline text-xs" on:click={downloadStego}>{t(dict, 'tools.ultimateEncrypt.downloadImage')}</button>
          </div>
        </div>
      {/if}

      <button type="button" class="btn-outline w-full text-xs" on:click={reset}>{t(dict, 'tools.ultimateEncrypt.encryptAnother')}</button>
    </div>
  {/if}
</div>
