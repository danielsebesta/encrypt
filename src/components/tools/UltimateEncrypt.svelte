<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { encrypt, decrypt } from '../../lib/crypto';
  import { encryptData } from '../../lib/ghost/crypto';
  import { createStegoImage } from '../../lib/ghost/steganography';
  import { uploadToNologSend } from '../../lib/nologSend';
  import CopyButton from '../CopyButton.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  type Step = 'input' | 'processing' | 'result';
  type DeliveryMode = 'auto' | 'link' | 'ghost';
  type ShortProvider = 'nolog' | 'dagd' | 'vgd' | 'spoome' | 'cleanuri' | 'isgd' | '1url';

  let step: Step = 'input';

  let textInput = '';
  let file: File | null = null;
  let password = '';
  let autoPassword = true;
  let enableStego = false;
  let enableTimelock = false;
  let timelockDate = '';
  let showAdvanced = false;

  let resultUrl = '';
  let shortUrl = '';
  let stegoImageUrl = '';
  let stegoImageBlob: Blob | null = null;
  let error = '';
  let progressTitle = '';
  let progressDetail = '';
  let debugLog: string[] = [];
  let qrDataUrl = '';

  const INLINE_LIMIT = 10 * 1024;
  const MAX_FILE = 50 * 1024 * 1024;
  const STEGO_THRESHOLD = 500 * 1024;

  // BINARY chain: raw file hosts only (no re-encoding risk)
  // Ordered by reliability + retention
  interface HostInfo { id: string; name: string; retention: string; maxBytes: number; }
  const BINARY_HOSTS: HostInfo[] = [
    { id: 'nologsend', name: 'upload.nolog.cz', retention: '2 days', maxBytes: 5 * 1024 * 1024 * 1024 },
    { id: 'quax', name: 'qu.ax', retention: '30 days', maxBytes: 256 * 1024 * 1024 },
    { id: 'x0at', name: 'x0.at', retention: '3-100 days', maxBytes: 512 * 1024 * 1024 },
    { id: 'catbox', name: 'Catbox.moe', retention: 'forever', maxBytes: 200 * 1024 * 1024 },
    { id: 'tmpfile', name: 'tmpfile.link', retention: '7 days', maxBytes: 100 * 1024 * 1024 },
    { id: 'litterbox', name: 'Litterbox', retention: '3 days', maxBytes: 1024 * 1024 * 1024 },
    { id: 'tempsh', name: 'temp.sh', retention: '3 days', maxBytes: 4 * 1024 * 1024 * 1024 },
    { id: 'uguu', name: 'Uguu.se', retention: '3 hours', maxBytes: 128 * 1024 * 1024 },
  ];

  // IMAGE chain: for stego PNGs only (these hosts accept images natively)
  const IMAGE_HOSTS: HostInfo[] = [
    { id: 'sxcu', name: 'sxcu.net', retention: 'forever', maxBytes: 95 * 1024 * 1024 },
    { id: 'freeimage', name: 'FreeImage.host', retention: 'forever', maxBytes: 64 * 1024 * 1024 },
    { id: 'imgbb', name: 'ImgBB', retention: 'forever', maxBytes: 32 * 1024 * 1024 },
  ];

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

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    file = target.files?.[0] ?? null;
    if (file) textInput = '';
  }

  function clearFile() {
    file = null;
  }

  function setProgress(title: string, detail = '') {
    progressTitle = title;
    progressDetail = detail;
  }

  function pushDebug(message: string) {
    const line = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${message}`;
    debugLog = [...debugLog, line];
    console.info('[UltimateEncrypt]', message);
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
      qrDataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 360,
        color: {
          dark: '#0f172a',
          light: '#f8fafc',
        },
      });
    } catch (e: any) {
      pushDebug(`QR generation failed: ${e?.message || 'unknown error'}`);
      qrDataUrl = '';
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

    // Use image hosts for stego PNGs, binary hosts for everything else
    // Filter by file size, try one at a time
    const chain = usedStego ? IMAGE_HOSTS : BINARY_HOSTS;
    const eligible = chain.filter(h => uploadBytes.length <= h.maxBytes);
    pushDebug(`Eligible upload hosts: ${eligible.map(h => h.name).join(', ') || 'none'}`);

    let uploadUrl = '';

    for (const host of eligible) {
      setProgress(t(dict, 'tools.ultimateEncrypt.progressSendingTitle'), t(dict, 'tools.ultimateEncrypt.progressSendingDetail'));
      try {
        pushDebug(`Trying host ${host.name} (${host.id})`);
        if (host.id === 'nologsend') {
          uploadUrl = await uploadToNologSend(uploadBytes, uploadFilename, usedStego ? 'image/png' : 'application/octet-stream', pushDebug);
          break;
        }
        const res = await fetch(`/api/ghost/upload?services=${host.id}&stego=${usedStego}&filename=${encodeURIComponent(uploadFilename)}`, {
          method: 'POST',
          body: uploadBytes,
        });
        pushDebug(`Host ${host.name} responded with HTTP ${res.status}`);
        if (!res.ok) {
          continue;
        }
        const data = await res.json() as any;
        const result = data?.results?.[0];
        if (result?.url) {
          uploadUrl = result.url;
          pushDebug(`Host ${host.name} returned URL ${uploadUrl}`);
          break;
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

  // PRIMARY: privacy-first (no tracking, no logs)
  const PRIMARY_SHORT: ShortProvider[] = ['nolog', 'dagd', 'vgd'];
  // FALLBACK: when primary fails (some tracking, but stable)
  const FALLBACK_SHORT: ShortProvider[] = ['spoome', 'cleanuri', 'isgd', '1url'];

  const SHORT_NAMES: Record<ShortProvider, string> = {
    nolog: 'Nolog.link', dagd: 'da.gd', vgd: 'v.gd',
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
    // Try primary providers (privacy-first)
    setProgress(t(dict, 'tools.ultimateEncrypt.progressShortenTitle'), t(dict, 'tools.ultimateEncrypt.progressShortenDetail'));
    for (const provider of PRIMARY_SHORT) {
      const result = await tryShorten(url, provider);
      if (result) { shortUrl = result; return; }
      // Retry once
      const retry = await tryShorten(url, provider);
      if (retry) { shortUrl = retry; return; }
    }
    // Fallback providers
    for (const provider of FALLBACK_SHORT) {
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
    setProgress('', '');
    if (stegoImageUrl) URL.revokeObjectURL(stegoImageUrl);
    stegoImageUrl = '';
    stegoImageBlob = null;
    qrDataUrl = '';
    debugLog = [];
  }

  onMount(() => {});
</script>

<div class="space-y-6 text-left">
  {#if step === 'input'}
    <div class="space-y-5">
      <div class="space-y-2">
        <label class="label block" for="ue-text">{t(dict, 'tools.ultimateEncrypt.messageLabel')}</label>
        <textarea
          id="ue-text"
          class="input min-h-[100px] resize-vertical font-mono text-xs"
          bind:value={textInput}
          placeholder={t(dict, 'tools.ultimateEncrypt.messagePlaceholder')}
          disabled={!!file}
        ></textarea>
      </div>

      <div class="space-y-2">
        <label class="label block" for="ue-file">{t(dict, 'tools.ultimateEncrypt.fileLabel')}</label>
        {#if file}
          <div class="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <span class="text-xs font-mono truncate flex-1">{file.name} <span class="text-zinc-400">({(file.size / 1024).toFixed(1)} KB)</span></span>
            <button type="button" class="text-[10px] font-bold text-red-500 hover:underline" on:click={clearFile}>{t(dict, 'tools.ultimateEncrypt.remove')}</button>
          </div>
        {:else}
          <input id="ue-file" type="file" class="input cursor-pointer text-xs" on:change={handleFileChange} />
        {/if}
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="label block" for="ue-pass">{t(dict, 'tools.ultimateEncrypt.passwordLabel')}</label>
          <label class="inline-flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" bind:checked={autoPassword} class="accent-emerald-500" />
            {t(dict, 'tools.ultimateEncrypt.autoGenerate')}
          </label>
        </div>
        {#if autoPassword}
          <p class="text-[11px] text-zinc-400 italic">{t(dict, 'tools.ultimateEncrypt.autoGenerateHint')}</p>
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

      {#if payloadSize > 0}
        <div class="flex items-center gap-2 text-[10px] text-zinc-400">
          <span class="font-bold uppercase tracking-widest">{t(dict, 'tools.ultimateEncrypt.modeLabel')}</span>
          {#if isLarge}
            <span class="text-amber-500">{t(dict, 'tools.ultimateEncrypt.modeUpload')} ({(payloadSize / 1024).toFixed(1)} KB)</span>
          {:else}
            <span class="text-emerald-500">{t(dict, 'tools.ultimateEncrypt.modeDirect')} ({payloadSize} bytes)</span>
          {/if}
        </div>
      {/if}

      <details class="text-xs" bind:open={showAdvanced}>
        <summary class="cursor-pointer select-none text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 font-bold uppercase tracking-widest text-[10px]">{t(dict, 'tools.ultimateEncrypt.advancedOptions')}</summary>
        <div class="mt-4 space-y-3 pl-1">
          <label class="flex items-center gap-2 cursor-pointer select-none text-zinc-500 dark:text-zinc-400">
            <input type="checkbox" bind:checked={enableStego} class="accent-emerald-500" />
            <span>{t(dict, 'tools.ultimateEncrypt.hideInImage')}</span>
          </label>
        </div>
      </details>

      {#if error}
        <p class="text-xs text-red-500">{error}</p>
        {#if debugLog.length}
          <details class="text-[11px]">
            <summary class="cursor-pointer select-none text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">{t(dict, 'tools.ultimateEncrypt.debugTitle')}</summary>
            <pre class="mt-2 whitespace-pre-wrap break-words rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 text-[10px] font-mono text-zinc-600 dark:text-zinc-300">{debugLog.join('\n')}</pre>
          </details>
        {/if}
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
      {#if debugLog.length}
        <details class="text-[11px]">
          <summary class="cursor-pointer select-none text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">{t(dict, 'tools.ultimateEncrypt.debugTitle')}</summary>
          <pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 text-[10px] font-mono text-zinc-600 dark:text-zinc-300">{debugLog.join('\n')}</pre>
        </details>
      {/if}
      {#if error}
        <p class="text-xs text-red-500">{error}</p>
      {/if}
    </div>

  {:else if step === 'result'}
    <div class="space-y-5">
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="label block">{shortUrl ? t(dict, 'tools.ultimateEncrypt.shareThisLink') : t(dict, 'tools.ultimateEncrypt.encryptedLink')}</label>
          <CopyButton text={shortUrl || resultUrl} label={t(dict, 'tools.ultimateEncrypt.copy')} />
        </div>
        <input class="input text-xs font-mono" type="text" readonly value={shortUrl || resultUrl} />
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

      {#if qrDataUrl && shareUrl}
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="label block">{t(dict, 'tools.ultimateEncrypt.qrTitle')}</label>
            <span class="text-[10px] uppercase tracking-widest text-zinc-400">{t(dict, 'tools.ultimateEncrypt.qrHint')}</span>
          </div>
          <div class="mx-auto max-w-[280px] rounded-[2rem] border border-emerald-200/70 dark:border-emerald-900/60 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.16),_transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,253,250,0.96))] dark:bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_58%),linear-gradient(180deg,rgba(9,24,23,0.96),rgba(10,18,18,0.98))] p-4 shadow-[0_20px_60px_rgba(16,185,129,0.12)]">
            <div class="relative overflow-hidden rounded-[1.5rem] border border-white/80 dark:border-zinc-800/80 bg-white/95 dark:bg-zinc-950/90 p-4">
              <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(16,185,129,0.08),transparent_38%,transparent_62%,rgba(15,23,42,0.05))] dark:bg-[linear-gradient(135deg,rgba(16,185,129,0.12),transparent_38%,transparent_62%,rgba(148,163,184,0.06))]"></div>
              <div class="relative mx-auto w-full max-w-[220px]">
                <img src={qrDataUrl} alt={t(dict, 'tools.ultimateEncrypt.qrAlt')} class="block w-full rounded-[1.25rem]" />
                <div class="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[1rem] border border-emerald-200/80 dark:border-emerald-900/70 bg-white/98 dark:bg-zinc-950/98 shadow-lg shadow-emerald-500/15">
                  <img src="/favicon.svg" alt="" class="h-7 w-7" />
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}

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

      {#if debugLog.length}
        <details class="text-[11px]">
          <summary class="cursor-pointer select-none text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">{t(dict, 'tools.ultimateEncrypt.debugTitle')}</summary>
          <pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 text-[10px] font-mono text-zinc-600 dark:text-zinc-300">{debugLog.join('\n')}</pre>
        </details>
      {/if}
    </div>
  {/if}
</div>
