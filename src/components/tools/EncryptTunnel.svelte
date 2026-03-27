<script lang="ts">
  import { onMount } from 'svelte';
  import { encryptData, decryptData } from '../../lib/ghost/crypto';
  import { createStegoImage, extractStego } from '../../lib/ghost/steganography';
  import CopyButton from '../CopyButton.svelte';
  import ProgressPulse from '../ProgressPulse.svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  const MAX_BYTES = 50 * 1024 * 1024;
  const STEGO_THRESHOLD = 500 * 1024;
  const STEGO_BLOWUP = 10;

  interface ServiceInfo {
    id: string;
    name: string;
    type: 'image' | 'file';
    maxBytes: number;
    retention: string;
    tosUrl: string | null;
    recommended?: boolean;
  }

  interface ParsedService extends ServiceInfo {
    retDays: number;
  }

  const STOPS = [
    { label: '3h', days: 0.125, full: '3 hours' },
    { label: '1d', days: 1, full: '1 day' },
    { label: '3d', days: 3, full: '3 days' },
    { label: '1w', days: 7, full: '1 week' },
    { label: '30d', days: 30, full: '30 days' },
    { label: '6mo', days: 180, full: '6 months' },
    { label: '∞', days: Infinity, full: 'Forever' },
  ];

  let mode: 'encrypt' | 'decrypt' = 'encrypt';
  let decryptMode: 'url' | 'file' = 'url';

  let file: File | null = null;
  let password = '';
  let autoPassword = true;
  let retIdx = 4;
  let services: ParsedService[] = [];
  let tooLarge = false;
  let uploading = false;
  let error = '';
  let progressTitle = '';
  let progressDetail = '';
  let resultUrl = '';
  let resultService = '';
  let failedIds: string[] = [];

  let decryptUrl = '';
  let decryptPassword = '';
  let decryptFile: File | null = null;
  let decrypting = false;
  let decryptError = '';
  let decryptedFile: { name: string; data: Uint8Array } | null = null;

  function setProgress(title: string, detail = '') {
    progressTitle = title;
    progressDetail = detail;
  }

  $: wantDays = STOPS[retIdx].days;
  $: wantLabel = STOPS[retIdx].full;
  $: candidates = file && !tooLarge && services.length > 0 ? rankProviders(wantDays, file.size) : [];
  $: provider = candidates[0] || null;
  $: isStego = provider?.type === 'image';
  $: altProviders = candidates.filter(c => !failedIds.includes(c.id) && c.id !== provider?.id);
  $: nearestShorter = file && !tooLarge && services.length > 0 && !provider ? findNearestRetention(file.size, 'shorter') : null;
  $: nearestLonger = file && !tooLarge && services.length > 0 && !provider ? findNearestRetention(file.size, 'longer') : null;

  function parseRetDays(r: string): number {
    const c = r.replace('*', '').trim().toLowerCase();
    if (c === 'forever' || c === 'unknown') return Infinity;
    const m = c.match(/^(\d+)\s*(hour|day|month|year)/);
    if (!m) return Infinity;
    const n = parseInt(m[1]);
    if (m[2].startsWith('hour')) return n / 24;
    if (m[2].startsWith('day')) return n;
    if (m[2].startsWith('month')) return n * 30;
    return n * 365;
  }

  function estimateUploadSize(size: number, type: 'image' | 'file'): number {
    if (type === 'image') return size * STEGO_BLOWUP;
    return Math.ceil(size * 1.37) + 200;
  }

  function rankProviders(days: number, size: number): ParsedService[] {
    return services
      .filter(s => {
        if (s.retDays < days) return false;
        if (s.maxBytes < estimateUploadSize(size, s.type)) return false;
        if (failedIds.includes(s.id)) return false;
        return true;
      })
      .sort((a, b) => {
        if (size <= STEGO_THRESHOLD) {
          if (a.type === 'image' && b.type !== 'image') return -1;
          if (a.type !== 'image' && b.type === 'image') return 1;
        } else {
          if (a.type === 'file' && b.type !== 'file') return -1;
          if (a.type !== 'file' && b.type === 'file') return 1;
        }
        if (a.recommended && !b.recommended) return -1;
        if (!a.recommended && b.recommended) return 1;
        const aDays = a.retDays === Infinity ? 99999 : a.retDays;
        const bDays = b.retDays === Infinity ? 99999 : b.retDays;
        return aDays - bDays;
      });
  }

  function findNearestRetention(size: number, dir: 'shorter' | 'longer'): number | null {
    const viable = services.filter(s => s.maxBytes >= estimateUploadSize(size, s.type) && !failedIds.includes(s.id));
    if (viable.length === 0) return null;
    if (dir === 'shorter') {
      for (let i = retIdx - 1; i >= 0; i--) {
        if (viable.some(s => s.retDays >= STOPS[i].days)) return i;
      }
    } else {
      for (let i = retIdx + 1; i < STOPS.length; i++) {
        if (viable.some(s => s.retDays >= STOPS[i].days)) return i;
      }
    }
    return null;
  }

  function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  function formatDays(d: number): string {
    if (d === Infinity) return 'Forever';
    if (d < 1) return `${Math.round(d * 24)} hours`;
    if (d === 1) return '1 day';
    if (d < 30) return `${Math.round(d)} days`;
    if (d < 365) return `${Math.round(d / 30)} months`;
    return `${Math.round(d / 365)} years`;
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/ghost/upload');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { services: ServiceInfo[] };
      services = (data.services || []).map(s => ({
        ...s,
        retDays: parseRetDays(s.retention),
      }));
    } catch {
      services = [];
    }
  });

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    file = target.files?.[0] || null;
    tooLarge = !!(file && file.size > MAX_BYTES);
    resultUrl = '';
    resultService = '';
    error = '';
    setProgress('', '');
    failedIds = [];
  }

  function generatePassword(len = 32): string {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~';
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  function randomFilename(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function arrayToBase64(arr: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    return btoa(binary);
  }

  function base64ToArray(b64: string): Uint8Array {
    const cleaned = b64.replace(/[^A-Za-z0-9+/=]/g, '').trim();
    const padded = cleaned.padEnd(Math.ceil(cleaned.length / 4) * 4, '=');
    const binary = atob(padded);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr;
  }

  async function handleUpload(specificId?: string) {
    if (!file || tooLarge) return;

    const target = specificId
      ? services.find(s => s.id === specificId) || null
      : provider;
    if (!target) {
      error = t(dict, 'tools.encryptTunnel.errorNoService');
      return;
    }

    if (!password && autoPassword) password = generatePassword();
    if (!password) { error = t(dict, 'tools.encryptTunnel.errorPasswordRequired'); return; }

    uploading = true;
    error = '';
    resultUrl = '';
    resultService = '';
    setProgress('', '');

    try {
      setProgress(t(dict, 'tools.encryptTunnel.progressReadingTitle'), t(dict, 'tools.encryptTunnel.progressReadingDetail'));
      const fileBuffer = new Uint8Array(await file.arrayBuffer());

      setProgress(t(dict, 'tools.encryptTunnel.progressEncryptingTitle'), t(dict, 'tools.encryptTunnel.progressEncryptingDetail'));
      const encrypted = await encryptData(fileBuffer, password, file.name);

      const useStego = target.type === 'image';
      const randomId = randomFilename();
      let uploadBlob: Blob;
      let uploadName: string;

      if (useStego) {
        setProgress(t(dict, 'tools.encryptTunnel.progressStegoTitle'), t(dict, 'tools.encryptTunnel.progressStegoDetail'));
        const stegoBuffer = await createStegoImage(encrypted);
        uploadBlob = new Blob([stegoBuffer], { type: 'image/png' });
        uploadName = `${randomId}.png`;
      } else {
        setProgress(t(dict, 'tools.encryptTunnel.progressEncodingTitle'), t(dict, 'tools.encryptTunnel.progressEncodingDetail'));
        const b64 = arrayToBase64(encrypted);
        uploadBlob = new Blob([b64], { type: 'text/plain' });
        uploadName = `${randomId}.txt`;
      }

      setProgress(t(dict, 'tools.encryptTunnel.progressUploadingTitle'), t(dict, 'tools.encryptTunnel.progressUploadingDetail'));
      const params = new URLSearchParams({ services: target.id, stego: useStego ? 'true' : 'false', filename: uploadName });
      const res = await fetch(`/api/ghost/upload?${params}`, {
        method: 'POST',
        body: uploadBlob,
        headers: { 'Content-Type': uploadBlob.type || 'application/octet-stream' },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(t(dict, 'tools.encryptTunnel.errorServer'));
      }

      let data: { results?: { service: string; url: string | null; error?: string }[]; error?: string };
      try {
        data = await res.json();
      } catch {
        throw new Error(t(dict, 'tools.encryptTunnel.errorInvalidResponse'));
      }

      if (data.error) throw new Error(data.error);

      const result = data.results?.[0];
      if (!result || !result.url) {
        throw new Error(result?.error || t(dict, 'tools.encryptTunnel.errorNoUrl'));
      }

      resultUrl = result.url;
      resultService = target.name;
      setProgress('', '');
    } catch (e: any) {
      failedIds = [...failedIds, target.id];
      const remaining = rankProviders(wantDays, file!.size);
      if (remaining.length > 0) {
        error = t(dict, 'tools.encryptTunnel.errorProviderFailed');
      } else {
        error = t(dict, 'tools.encryptTunnel.errorNoAlternative');
      }
    } finally {
      uploading = false;
    }
  }

  async function handleDecrypt() {
    decryptError = '';
    decryptedFile = null;

    if (!decryptPassword.trim()) { decryptError = t(dict, 'tools.encryptTunnel.errorPasswordRequired'); return; }
    if (decryptMode === 'url' && !decryptUrl.trim()) { decryptError = t(dict, 'tools.encryptTunnel.errorUrlRequired'); return; }
    if (decryptMode === 'file' && !decryptFile) { decryptError = t(dict, 'tools.encryptTunnel.errorFileRequired'); return; }

    decrypting = true;
    setProgress('', '');

    try {
      let encryptedData: Uint8Array;
      let isImage = false;

      if (decryptMode === 'url') {
        setProgress(t(dict, 'tools.encryptTunnel.progressFetchingTitle'), t(dict, 'tools.encryptTunnel.progressFetchingDetail'));
        isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(decryptUrl) ||
                  /ibb\.co|iili\.io|sxcu\.net|freeimage\.host/i.test(decryptUrl);

        const proxyUrl = `/api/ghost/fetch?url=${encodeURIComponent(decryptUrl)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) {
          let errMsg = `HTTP ${res.status}`;
          try {
            const d = await res.json() as { error?: string };
            errMsg = d.error || errMsg;
          } catch {}
          throw new Error(errMsg);
        }

        if (isImage) {
          setProgress(t(dict, 'tools.encryptTunnel.progressExtractingTitle'), t(dict, 'tools.encryptTunnel.progressExtractingDetail'));
          const imgBuffer = new Uint8Array(await res.arrayBuffer());
          const extracted = await extractStego(imgBuffer);
          if (!extracted) throw new Error(t(dict, 'tools.encryptTunnel.errorNoHiddenData'));
          encryptedData = extracted;
        } else {
          const text = await res.text();
          if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().toLowerCase().startsWith('<html')) {
            throw new Error(t(dict, 'tools.encryptTunnel.errorHtmlPage'));
          }
          setProgress(t(dict, 'tools.encryptTunnel.progressDecodingTitle'), t(dict, 'tools.encryptTunnel.progressDecodingDetail'));
          encryptedData = base64ToArray(text);
        }
      } else {
        if (!decryptFile) throw new Error(t(dict, 'tools.encryptTunnel.errorFileRequired'));
        isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(decryptFile.name);
        setProgress(t(dict, 'tools.encryptTunnel.progressReadingTitle'), t(dict, 'tools.encryptTunnel.progressReadingSelected'));
        const buffer = new Uint8Array(await decryptFile.arrayBuffer());

        if (isImage) {
          setProgress(t(dict, 'tools.encryptTunnel.progressExtractingTitle'), t(dict, 'tools.encryptTunnel.progressExtractingDetail'));
          const extracted = await extractStego(buffer);
          if (!extracted) throw new Error(t(dict, 'tools.encryptTunnel.errorNoHiddenData'));
          encryptedData = extracted;
        } else {
          setProgress(t(dict, 'tools.encryptTunnel.progressDecodingTitle'), t(dict, 'tools.encryptTunnel.progressDecodingDetail'));
          encryptedData = base64ToArray(new TextDecoder().decode(buffer));
        }
      }

      setProgress(t(dict, 'tools.encryptTunnel.progressDecryptingTitle'), t(dict, 'tools.encryptTunnel.progressDecryptingDetail'));
      const decrypted = await decryptData(encryptedData, decryptPassword);

      decryptedFile = { name: decrypted.name || 'decrypted-file', data: decrypted.data };
      setProgress('', '');
    } catch (e: any) {
      decryptError = e?.message || t(dict, 'tools.encryptTunnel.errorDecryptionFailed');
    } finally {
      decrypting = false;
    }
  }

  function downloadDecrypted() {
    if (!decryptedFile) return;
    const blob = new Blob([decryptedFile.data.buffer as ArrayBuffer]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = decryptedFile.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDecryptFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    decryptFile = target.files?.[0] || null;
    decryptError = '';
    decryptedFile = null;
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  <div class="inline-flex rounded-full bg-zinc-100 dark:bg-zinc-900/70 p-1 text-xs font-semibold">
    <button
      type="button"
      class="px-4 py-1.5 rounded-full transition-colors"
      class:bg-white={mode === 'encrypt'}
      class:text-zinc-900={mode === 'encrypt'}
      class:text-zinc-500={mode !== 'encrypt'}
      class:dark:bg-zinc-800={mode === 'encrypt'}
      class:dark:text-zinc-100={mode === 'encrypt'}
      on:click={() => { mode = 'encrypt'; setProgress('', ''); decryptError = ''; decryptedFile = null; }}
    >
      Encrypt &amp; Upload
    </button>
    <button
      type="button"
      class="px-4 py-1.5 rounded-full transition-colors"
      class:bg-white={mode === 'decrypt'}
      class:text-zinc-900={mode === 'decrypt'}
      class:text-zinc-500={mode !== 'decrypt'}
      class:dark:bg-zinc-800={mode === 'decrypt'}
      class:dark:text-zinc-100={mode === 'decrypt'}
      on:click={() => { mode = 'decrypt'; setProgress('', ''); error = ''; resultUrl = ''; }}
    >
      {t(dict, 'tools.encryptTunnel.decryptTab')}
    </button>
  </div>

  {#if mode === 'encrypt'}
    <div class="card p-6 md:p-8 space-y-6">
      <div class="space-y-3">
        <label for="ghost-file" class="label block">
          {t(dict, 'tools.encryptTunnel.fileToEncrypt')}
        </label>
        <input id="ghost-file" type="file" class="input cursor-pointer" on:change={handleFileChange} />
        {#if file}
          <p class="text-[11px] text-zinc-500 dark:text-zinc-400">
            {t(dict, 'tools.encryptTunnel.selected')} <span class="font-mono">{file.name}</span>
            <span class="opacity-75">— {formatBytes(file.size)}</span>
          </p>
        {/if}
        {#if tooLarge}
          <p class="text-xs text-red-500 font-semibold">{t(dict, 'tools.encryptTunnel.fileTooLarge')}</p>
        {/if}
      </div>

      <div class="space-y-2">
        <label for="ghost-password" class="label block">
          {t(dict, 'tools.encryptTunnel.encryptionPassword')}
        </label>
        <input
          id="ghost-password"
          type="text"
          class="input font-mono text-sm"
          bind:value={password}
          autocomplete="new-password"
          spellcheck="false"
        />
        <div class="flex items-center gap-2 flex-wrap">
          <label class="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <input type="checkbox" bind:checked={autoPassword} />
            {t(dict, 'tools.encryptTunnel.autoGenerate')}
          </label>
          <button
            type="button"
            class="btn-outline text-[11px] px-3 py-1"
            on:click={() => (password = generatePassword())}
          >
            {t(dict, 'tools.encryptTunnel.generate')}
          </button>
        </div>
      </div>

      <div class="space-y-3">
        <label class="label block">
          {t(dict, 'tools.encryptTunnel.fileRetention')} <span class="text-emerald-600 dark:text-emerald-400">{wantLabel}</span>
        </label>
        <input
          type="range"
          min="0"
          max="6"
          step="1"
          bind:value={retIdx}
          class="w-full h-2 rounded-full appearance-none cursor-pointer bg-zinc-200 dark:bg-zinc-700 accent-emerald-500"
        />
        <div class="flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500 px-0.5 select-none">
          {#each STOPS as stop, i}
            <button
              type="button"
              class="hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors {i === retIdx ? 'text-emerald-600 dark:text-emerald-400 font-bold' : ''}"
              on:click={() => (retIdx = i)}
            >
              {stop.label}
            </button>
          {/each}
        </div>
      </div>

      {#if provider}
        <div class="p-4 rounded-xl border transition-colors {isStego ? 'bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900/50' : 'bg-zinc-50 dark:bg-zinc-900/50 border-zinc-200 dark:border-zinc-700'}">
          <div class="flex items-center gap-2 text-xs {isStego ? 'text-purple-700 dark:text-purple-300' : 'text-zinc-700 dark:text-zinc-300'}">
            {#if isStego}
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
            {/if}
            <span><span class="font-bold">{provider.name}</span>{#if isStego} — {t(dict, 'tools.encryptTunnel.steganographyMode')}{/if}</span>
            {#if provider.tosUrl}
              <a href={provider.tosUrl} target="_blank" rel="noopener noreferrer" class="ml-auto text-[10px] text-blue-500 hover:underline shrink-0">{t(dict, 'tools.encryptTunnel.terms')}</a>
            {/if}
          </div>
          <div class="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
            {t(dict, 'tools.encryptTunnel.keepsYourFileFor')} {provider.retDays === Infinity ? t(dict, 'tools.encryptTunnel.unlimitedTime') : formatDays(provider.retDays)}{isStego ? ` · ${t(dict, 'tools.encryptTunnel.dataHiddenInImage')}` : ''}
          </div>
        </div>
      {:else if file && !tooLarge && services.length > 0}
        <div class="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 space-y-2">
          <p class="text-xs text-amber-700 dark:text-amber-400">{t(dict, 'tools.encryptTunnel.noProviderAvailable')}</p>
          <div class="flex gap-2 flex-wrap">
            {#if nearestShorter !== null}
              <button type="button" class="btn-outline text-[10px] px-3 py-1.5" on:click={() => (retIdx = nearestShorter)}>
                {t(dict, 'tools.encryptTunnel.tryInstead')} {STOPS[nearestShorter].full}
              </button>
            {/if}
            {#if nearestLonger !== null}
              <button type="button" class="btn-outline text-[10px] px-3 py-1.5" on:click={() => (retIdx = nearestLonger)}>
                {t(dict, 'tools.encryptTunnel.tryInstead')} {STOPS[nearestLonger].full}
              </button>
            {/if}
          </div>
        </div>
      {:else if file && !tooLarge && services.length === 0}
        <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700">
          <p class="text-xs text-zinc-500 dark:text-zinc-400">{t(dict, 'tools.encryptTunnel.loadingProviders')}</p>
        </div>
      {/if}

      <button
        type="button"
        class="btn w-full py-4 uppercase font-black tracking-widest text-xs"
        on:click={() => handleUpload()}
        disabled={!file || tooLarge || uploading || !provider}
      >
        {#if uploading}
          {t(dict, 'tools.encryptTunnel.processing')}
        {:else}
          {t(dict, 'tools.encryptTunnel.encryptAndUpload')}
        {/if}
      </button>

      {#if uploading}
        <ProgressPulse title={progressTitle || t(dict, 'tools.encryptTunnel.progressDefaultTitle')} detail={progressDetail || t(dict, 'tools.encryptTunnel.progressDefaultDetail')} compact={true} />
      {/if}

      {#if error}
        <div class="space-y-2">
          <p class="text-xs text-red-500">{error}</p>
          {#if altProviders.length > 0}
            <div class="flex gap-2 flex-wrap">
              {#each altProviders.slice(0, 3) as alt}
                <button
                  type="button"
                  class="btn-outline text-[10px] px-3 py-1.5"
                  on:click={() => handleUpload(alt.id)}
                >
                  {t(dict, 'tools.encryptTunnel.tryAlternative')} {alt.name} ({alt.type === 'image' ? t(dict, 'tools.encryptTunnel.stegoShort') : t(dict, 'tools.encryptTunnel.fileShort')}, {alt.retDays === Infinity ? '∞' : formatDays(alt.retDays)})
                </button>
              {/each}
            </div>
          {/if}
          {#if altProviders.length === 0}
            <div class="flex gap-2 flex-wrap">
              {#if nearestShorter !== null}
                <button type="button" class="btn-outline text-[10px] px-3 py-1.5" on:click={() => { retIdx = nearestShorter; failedIds = []; error = ''; }}>
                  {t(dict, 'tools.encryptTunnel.tryRetention')} {STOPS[nearestShorter].full}
                </button>
              {/if}
              {#if nearestLonger !== null}
                <button type="button" class="btn-outline text-[10px] px-3 py-1.5" on:click={() => { retIdx = nearestLonger; failedIds = []; error = ''; }}>
                  {t(dict, 'tools.encryptTunnel.tryRetention')} {STOPS[nearestLonger].full}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if resultUrl}
      <div class="card p-6 md:p-8 space-y-4">
        <h3 class="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
          {t(dict, 'tools.encryptTunnel.uploadSuccessful')} — {resultService}
        </h3>
        <div class="flex gap-2 items-center">
          <input type="text" readonly class="input font-mono text-xs flex-1" value={resultUrl} />
          <CopyButton text={resultUrl} label={t(dict, 'tools.encryptTunnel.copy')} className="btn-outline text-xs" />
        </div>
      </div>

      <div class="card p-6 md:p-8 space-y-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
        <h3 class="text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
          {t(dict, 'tools.encryptTunnel.yourEncryptionPassword')}
        </h3>
        <div class="flex gap-2 items-center">
          <input type="text" readonly class="input font-mono text-xs flex-1 bg-white dark:bg-zinc-900" value={password} />
          <CopyButton text={password} label={t(dict, 'tools.encryptTunnel.copy')} className="btn-outline text-xs" />
        </div>
        <p class="text-[10px] text-amber-600 dark:text-amber-400/80">
          {t(dict, 'tools.encryptTunnel.savePassword')}
        </p>
      </div>
    {/if}

  {:else}
    <div class="card p-6 md:p-8 space-y-6">
      <div class="inline-flex rounded-lg bg-zinc-100 dark:bg-zinc-900 p-1 text-[11px] font-semibold">
        <button
          type="button"
          class="px-3 py-1 rounded-md transition-colors"
          class:bg-white={decryptMode === 'url'}
          class:text-zinc-900={decryptMode === 'url'}
          class:text-zinc-500={decryptMode !== 'url'}
          class:dark:bg-zinc-800={decryptMode === 'url'}
          class:dark:text-zinc-100={decryptMode === 'url'}
          on:click={() => { decryptMode = 'url'; decryptError = ''; }}
        >
          {t(dict, 'tools.encryptTunnel.fromUrl')}
        </button>
        <button
          type="button"
          class="px-3 py-1 rounded-md transition-colors"
          class:bg-white={decryptMode === 'file'}
          class:text-zinc-900={decryptMode === 'file'}
          class:text-zinc-500={decryptMode !== 'file'}
          class:dark:bg-zinc-800={decryptMode === 'file'}
          class:dark:text-zinc-100={decryptMode === 'file'}
          on:click={() => { decryptMode = 'file'; decryptError = ''; }}
        >
          {t(dict, 'tools.encryptTunnel.fromFile')}
        </button>
      </div>

      {#if decryptMode === 'url'}
        <div class="space-y-3">
          <label for="decrypt-url" class="label block">
            {t(dict, 'tools.encryptTunnel.urlToEncryptedFile')}
          </label>
          <input
            id="decrypt-url"
            type="text"
            class="input font-mono text-sm"
            bind:value={decryptUrl}
            placeholder={t(dict, 'tools.encryptTunnel.urlPlaceholder')}
          />
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500">
            {t(dict, 'tools.encryptTunnel.urlHelp')}
          </p>
        </div>
      {:else}
        <div class="space-y-3">
          <label for="decrypt-file" class="label block">
            {t(dict, 'tools.encryptTunnel.selectEncryptedFile')}
          </label>
          <input id="decrypt-file" type="file" class="input cursor-pointer" on:change={handleDecryptFileChange} />
          {#if decryptFile}
            <p class="text-[11px] text-zinc-500 dark:text-zinc-400">
              {t(dict, 'tools.encryptTunnel.selected')} <span class="font-mono">{decryptFile.name}</span>
            </p>
          {/if}
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500">
            {t(dict, 'tools.encryptTunnel.fileHelp')}
          </p>
        </div>
      {/if}

      <div class="space-y-3">
        <label for="decrypt-password" class="label block">
          {t(dict, 'tools.encryptTunnel.decryptionPassword')}
        </label>
        <input
          id="decrypt-password"
          type="text"
          class="input font-mono text-sm"
          bind:value={decryptPassword}
          placeholder={t(dict, 'tools.encryptTunnel.decryptionPlaceholder')}
        />
      </div>

      <button
        type="button"
        class="btn w-full py-4 uppercase font-black tracking-widest text-xs"
        on:click={handleDecrypt}
        disabled={decrypting}
      >
        {#if decrypting}
          {t(dict, 'tools.encryptTunnel.decrypting')}
        {:else}
          {t(dict, 'tools.encryptTunnel.decryptFile')}
        {/if}
      </button>

      {#if decrypting}
        <ProgressPulse title={progressTitle || t(dict, 'tools.encryptTunnel.progressDecryptDefaultTitle')} detail={progressDetail || t(dict, 'tools.encryptTunnel.progressDecryptDefaultDetail')} compact={true} />
      {/if}

      {#if decryptError}
        <p class="text-xs text-red-500">{decryptError}</p>
      {/if}

      {#if decryptedFile}
        <div class="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
          <div class="flex items-center gap-3">
            <div class="flex-1">
              <div class="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{t(dict, 'tools.encryptTunnel.decryptedSuccessfully')}</div>
              <div class="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">{decryptedFile.name} — {formatBytes(decryptedFile.data.length)}</div>
            </div>
            <button type="button" class="btn text-xs" on:click={downloadDecrypted}>
              {t(dict, 'tools.encryptTunnel.download')}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
