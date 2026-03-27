<script lang="ts">
  import { onMount } from 'svelte';
  import { decrypt } from '../../lib/crypto';
  import { decryptData } from '../../lib/ghost/crypto';
  import { extractStego } from '../../lib/ghost/steganography';
  import { downloadFromNologSend, isNologSendUrl } from '../../lib/nologSend';
  import CopyButton from '../CopyButton.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let password = '';
  let error = '';
  let loading = false;
  let progressTitle = '';
  let progressDetail = '';
  let debugLog: string[] = [];

  let hashPayload = '';
  let hasHash = false;

  let openedText = '';
  let openedFileName = '';
  let openedFileUrl = '';
  let openedFileMime = '';

  type PreviewType = 'none' | 'image' | 'video' | 'audio' | 'pdf';
  let previewType: PreviewType = 'none';

  function mimeFromName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
      mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
      mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
      m4a: 'audio/mp4', opus: 'audio/opus',
      pdf: 'application/pdf',
    };
    return map[ext] || 'application/octet-stream';
  }

  function detectPreview(mime: string): PreviewType {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'application/pdf') return 'pdf';
    return 'none';
  }

  let stegoFile: File | null = null;
  let manualMode = false;

  function setProgress(title: string, detail = '') {
    progressTitle = title;
    progressDetail = detail;
  }

  function pushDebug(message: string) {
    const line = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${message}`;
    debugLog = [...debugLog, line];
    console.info('[UltimateDecrypt]', message);
  }

  function base64UrlDecode(input: string): Uint8Array {
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  onMount(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    pushDebug(`Page opened: path=${window.location.pathname}, hashLength=${hash.length}, search=${window.location.search || '(empty)'}`);
    if (hash.length > 1) {
      hasHash = true;
      hashPayload = decodeURIComponent(hash.slice(1));
      pushDebug(`Hash payload detected (${hashPayload.length} chars)`);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const queryPayload = params.get('p');
    if (queryPayload) {
      hasHash = true;
      hashPayload = decodeURIComponent(queryPayload);
      pushDebug(`Query payload detected (${hashPayload.length} chars), normalizing to hash`);
      history.replaceState(null, '', `${window.location.pathname}#${encodeURIComponent(queryPayload)}`);
      pushDebug(`URL normalized to hash on ${window.location.pathname}`);
    } else {
      pushDebug('No encrypted payload found in URL on initial load');
    }
  });

  function handleStegoFile(e: Event) {
    const target = e.target as HTMLInputElement;
    stegoFile = target.files?.[0] ?? null;
  }

  async function handleDecrypt() {
    error = '';
    openedText = '';
    openedFileName = '';
    setProgress('', '');
    debugLog = [];
    if (openedFileUrl) {
      URL.revokeObjectURL(openedFileUrl);
      openedFileUrl = '';
    }

    pushDebug(`Decrypt requested: hasHash=${hasHash}, hashLength=${hashPayload.length}, stegoFile=${stegoFile ? `${stegoFile.name} (${stegoFile.size} bytes)` : 'none'}`);
    if (!password) {
      error = t(dict, 'tools.ultimateDecrypt.errorPasswordRequired');
      pushDebug('Validation failed: missing password');
      return;
    }

    loading = true;
    try {
      if (stegoFile && !hasHash) {
        pushDebug('Using stego image as source');
        await decryptFromStego();
      } else if (hashPayload) {
        pushDebug('Using URL payload as source');
        await decryptFromHash();
      } else {
        error = t(dict, 'tools.ultimateDecrypt.errorNoData');
        pushDebug('Validation failed: no payload source available');
      }
    } catch (e: any) {
      console.error('Decrypt error', e);
      error = t(dict, 'tools.ultimateDecrypt.errorDecryptFailed');
      pushDebug(`Decrypt failed: ${e?.message || 'unknown error'}`);
    } finally {
      loading = false;
    }
  }

  async function decryptFromStego() {
    setProgress(t(dict, 'tools.ultimateDecrypt.progressReadingTitle'), t(dict, 'tools.ultimateDecrypt.progressReadingDetail'));
    const buffer = new Uint8Array(await stegoFile!.arrayBuffer());
    pushDebug(`Stego image loaded (${buffer.byteLength} bytes)`);
    const extracted = await extractStego(buffer);
    if (!extracted) {
      pushDebug('Stego extraction returned no hidden data');
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorNoHiddenData'));
    }
    pushDebug(`Stego extraction succeeded (${extracted.byteLength} bytes)`);

    const text = new TextDecoder().decode(extracted);

    if (text.startsWith('http')) {
      setProgress(t(dict, 'tools.ultimateDecrypt.progressFollowingTitle'), t(dict, 'tools.ultimateDecrypt.progressFollowingDetail'));
      const url = new URL(text);
      const innerHash = url.hash.slice(1);
      pushDebug(`Stego payload contained URL ${url.origin}${url.pathname}, hashLength=${innerHash.length}`);
      if (innerHash) {
        hashPayload = decodeURIComponent(innerHash);
        pushDebug(`Inner hash payload accepted (${hashPayload.length} chars)`);
        await decryptFromHash();
      } else {
        pushDebug('Stego URL had no encrypted hash payload');
        throw new Error(t(dict, 'tools.ultimateDecrypt.errorNoEncryptedPayload'));
      }
    } else {
      pushDebug('Stego payload was not a supported URL');
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnexpectedStego'));
    }
  }

  async function decryptFromHash() {
    setProgress(t(dict, 'tools.ultimateDecrypt.progressDecryptingTitle'), t(dict, 'tools.ultimateDecrypt.progressDecryptingDetail'));
    pushDebug(`Decoding hash payload (${hashPayload.length} chars)`);
    const bytes = base64UrlDecode(hashPayload);
    pushDebug(`Decoded outer payload to ${bytes.byteLength} bytes`);
    const compressedB64 = await decrypt(bytes, password);
    pushDebug(`Outer payload decrypted to base64 string (${compressedB64.length} chars)`);
    const compressed = Uint8Array.from(atob(compressedB64), c => c.charCodeAt(0));
    pushDebug(`Outer payload base64-decoded to ${compressed.byteLength} bytes`);

    let json: string;
    try {
      const decompressed = await gunzipBytes(compressed);
      json = new TextDecoder().decode(decompressed);
      pushDebug(`Outer payload gunzipped to ${decompressed.byteLength} bytes`);
    } catch {
      json = compressedB64;
      pushDebug('Outer payload was not gzipped, using plaintext JSON fallback');
    }

    const data = JSON.parse(json) as any;
    pushDebug(`Outer payload parsed: mode=${data.mode || 'unknown'}, version=${data.v ?? 'unknown'}`);

    if (data.v !== 1) {
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnsupportedVersion'));
    }

    if (data.mode === 'inline') {
      await handleInlinePayload(data);
    } else if (data.mode === 'ghost') {
      await handleGhostPayload(data);
    } else {
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnknownMode'));
    }
  }

  function presentFile(bytes: Uint8Array, name: string) {
    const mime = mimeFromName(name);
    openedFileMime = mime;
    previewType = detectPreview(mime);
    const blob = new Blob([bytes], { type: mime });
    openedFileUrl = URL.createObjectURL(blob);
    openedFileName = name;
    pushDebug(`Prepared output file ${name} (${bytes.byteLength} bytes, mime=${mime}, preview=${previewType})`);
    setProgress(t(dict, 'tools.ultimateDecrypt.progressReadyTitle'), t(dict, 'tools.ultimateDecrypt.progressReadyFile'));
  }

  async function handleInlinePayload(data: any) {
    if (data.kind === 'text') {
      pushDebug(`Inline text payload opened (${(data.text || '').length} chars)`);
      setProgress(t(dict, 'tools.ultimateDecrypt.progressReadyTitle'), t(dict, 'tools.ultimateDecrypt.progressReadyText'));
      openedText = data.text || '';
    } else if (data.kind === 'file' && data.data) {
      const binary = atob(data.data);
      const buf = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
      pushDebug(`Inline file payload opened (${buf.byteLength} bytes, name=${data.name || 'download'})`);
      presentFile(buf, data.name || 'download');
    } else {
      throw new Error(t(dict, 'tools.ultimateDecrypt.errorUnsupportedInline'));
    }
  }

  async function handleGhostPayload(data: any) {
    const urls: string[] = data.urls || (data.url ? [data.url] : []);
    const isStego: boolean = data.stego ?? false;
    pushDebug(`Ghost payload opened: urls=${urls.length}, stego=${isStego}`);

    if (urls.length === 0) throw new Error(t(dict, 'tools.ultimateDecrypt.errorNoDownloadUrls'));

    let lastErr = '';

    for (const url of urls) {
      try {
        setProgress(t(dict, 'tools.ultimateDecrypt.progressFetchingTitle'), t(dict, 'tools.ultimateDecrypt.progressFetchingDetail'));
        pushDebug(`Trying download source ${url}`);
        let fileBytes: Uint8Array;

        if (isNologSendUrl(url)) {
          pushDebug('Detected upload.nolog.cz Send URL');
          fileBytes = await downloadFromNologSend(url, pushDebug);
        } else {
          const res = await fetch(`/api/ghost/fetch?url=${encodeURIComponent(url)}`);
          pushDebug(`Proxy fetch response HTTP ${res.status} for ${url}`);
          if (!res.ok) {
            lastErr = t(dict, 'tools.ultimateDecrypt.errorFetchFailed');
            pushDebug(`Source failed before body read: ${lastErr}`);
            continue;
          }
          fileBytes = new Uint8Array(await res.arrayBuffer());
          pushDebug(`Downloaded encrypted blob (${fileBytes.byteLength} bytes)`);
        }

        setProgress(t(dict, 'tools.ultimateDecrypt.progressDownloadedTitle'), t(dict, 'tools.ultimateDecrypt.progressDownloadedDetail'));

        let encrypted: Uint8Array;
        if (isStego) {
          setProgress(t(dict, 'tools.ultimateDecrypt.progressExtractingTitle'), t(dict, 'tools.ultimateDecrypt.progressExtractingDetail'));
          const extracted = await extractStego(fileBytes);
          if (!extracted) {
            lastErr = t(dict, 'tools.ultimateDecrypt.errorNoHiddenData');
            pushDebug('Downloaded image had no hidden payload');
            continue;
          }
          encrypted = extracted;
          pushDebug(`Extracted encrypted payload from image (${encrypted.byteLength} bytes)`);
        } else {
          encrypted = fileBytes;
          pushDebug(`Using raw encrypted payload (${encrypted.byteLength} bytes)`);
        }

        const { data: decryptedData, name } = await decryptData(encrypted, password);
        pushDebug(`Inner payload decrypted successfully (${decryptedData.byteLength} bytes, name=${name})`);

        if (name.endsWith('.txt') && decryptedData.length < 100_000) {
          const text = new TextDecoder().decode(decryptedData);
          const isPrintable = !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 200));
          if (isPrintable) {
            openedText = text;
            pushDebug(`Printable text result detected (${text.length} chars)`);
            setProgress(t(dict, 'tools.ultimateDecrypt.progressReadyTitle'), t(dict, 'tools.ultimateDecrypt.progressReadyText'));
            return;
          }
        }

        presentFile(decryptedData, name);
        return;
      } catch (e: any) {
        lastErr = e?.message || t(dict, 'tools.ultimateDecrypt.errorDecryptFailed');
        pushDebug(`Source ${url} failed: ${lastErr}`);
      }
    }

    throw new Error(lastErr || t(dict, 'tools.ultimateDecrypt.errorAllSourcesFailed'));
  }

  function downloadFile() {
    if (!openedFileUrl || !openedFileName) return;
    const a = document.createElement('a');
    a.href = openedFileUrl;
    a.download = openedFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
</script>

<div class="space-y-6 text-left">
  {#if hasHash}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">
      {t(dict, 'tools.ultimateDecrypt.payloadFound')}
    </p>
  {:else}
    <div class="space-y-4">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">
        {t(dict, 'tools.ultimateDecrypt.noPayloadIntro')} <code class="text-emerald-500">/u#...</code> {t(dict, 'tools.ultimateDecrypt.noPayloadIntroRest')}
      </p>
      <div class="space-y-2">
        <label class="label block" for="ud-stego">{t(dict, 'tools.ultimateDecrypt.uploadStegoImage')}</label>
        <input id="ud-stego" type="file" accept="image/*" class="input cursor-pointer text-xs" on:change={handleStegoFile} />
      </div>
    </div>
  {/if}

  <div class="space-y-2">
    <label class="label block" for="ud-pass">{t(dict, 'tools.ultimateDecrypt.passwordLabel')}</label>
    <input
      id="ud-pass"
      type="password"
      class="input"
      bind:value={password}
      autocomplete="current-password"
      placeholder={t(dict, 'tools.ultimateDecrypt.passwordPlaceholder')}
    />
  </div>

  <button
    class="btn w-full"
    type="button"
    on:click={handleDecrypt}
    disabled={loading || (!hasHash && !stegoFile)}
  >
    {loading ? t(dict, 'tools.ultimateDecrypt.decrypting') : t(dict, 'tools.ultimateDecrypt.decrypt')}
  </button>

  {#if loading}
    <ProgressPulse title={progressTitle || t(dict, 'tools.ultimateDecrypt.progressDefaultTitle')} detail={progressDetail || t(dict, 'tools.ultimateDecrypt.progressDefaultDetail')} compact={true} />
  {/if}

  {#if loading && debugLog.length}
    <details class="text-[11px]">
      <summary class="cursor-pointer select-none text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">{t(dict, 'tools.ultimateDecrypt.debugTitle')}</summary>
      <pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 text-[10px] font-mono text-zinc-600 dark:text-zinc-300">{debugLog.join('\n')}</pre>
    </details>
  {/if}

  {#if error}
    <p class="text-xs text-red-500">{error}</p>
    {#if debugLog.length}
      <details class="text-[11px]">
        <summary class="cursor-pointer select-none text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">{t(dict, 'tools.ultimateDecrypt.debugTitle')}</summary>
        <pre class="mt-2 whitespace-pre-wrap break-words rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 text-[10px] font-mono text-zinc-600 dark:text-zinc-300">{debugLog.join('\n')}</pre>
      </details>
    {/if}
  {/if}

  {#if openedText}
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="label block">{t(dict, 'tools.ultimateDecrypt.decryptedMessage')}</label>
        <CopyButton text={openedText} label={t(dict, 'tools.ultimateDecrypt.copy')} />
      </div>
      <div class="result-box min-h-[80px] whitespace-pre-wrap">
        {openedText}
      </div>
    </div>
  {/if}

  {#if openedFileName && openedFileUrl}
    <div class="space-y-3">
      <p class="text-xs text-emerald-500">{t(dict, 'tools.ultimateDecrypt.fileDecrypted')} {openedFileName}</p>

      {#if previewType === 'image'}
        <img src={openedFileUrl} alt={openedFileName} class="max-w-full rounded-xl border border-zinc-200 dark:border-zinc-800" />
      {:else if previewType === 'video'}
        <video src={openedFileUrl} controls class="max-w-full rounded-xl border border-zinc-200 dark:border-zinc-800">
          <track kind="captions" />
        </video>
      {:else if previewType === 'audio'}
        <audio src={openedFileUrl} controls class="w-full"></audio>
      {:else if previewType === 'pdf'}
        <iframe src={openedFileUrl} title={openedFileName} class="w-full h-[70vh] rounded-xl border border-zinc-200 dark:border-zinc-800"></iframe>
      {/if}

      <button type="button" class="btn-outline text-xs" on:click={downloadFile}>
        {t(dict, 'tools.ultimateDecrypt.download')} {openedFileName}
      </button>
    </div>
  {/if}

  {#if !loading && !error && debugLog.length}
    <details class="text-[11px]">
      <summary class="cursor-pointer select-none text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">{t(dict, 'tools.ultimateDecrypt.debugTitle')}</summary>
      <pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 text-[10px] font-mono text-zinc-600 dark:text-zinc-300">{debugLog.join('\n')}</pre>
    </details>
  {/if}
</div>
