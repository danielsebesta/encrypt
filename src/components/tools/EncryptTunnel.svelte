<script lang="ts">
  import { onMount } from 'svelte';
  import { encryptData, decryptData } from '../../lib/ghost/crypto';
  import { createStegoImage, extractStego } from '../../lib/ghost/steganography';

  const MAX_BYTES = 25 * 1024 * 1024;
  const STEGO_THRESHOLD = 5 * 1024 * 1024;

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
  let logs: string[] = [];
  let resultUrl = '';
  let resultService = '';
  let failedIds: string[] = [];

  let decryptUrl = '';
  let decryptPassword = '';
  let decryptFile: File | null = null;
  let decrypting = false;
  let decryptError = '';
  let decryptedFile: { name: string; data: Uint8Array } | null = null;

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

  function rankProviders(days: number, size: number): ParsedService[] {
    const est = size + 200;
    return services
      .filter(s => {
        if (s.retDays < days) return false;
        if (s.maxBytes < est) return false;
        if (failedIds.includes(s.id)) return false;
        return true;
      })
      .sort((a, b) => {
        if (est <= STEGO_THRESHOLD) {
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
    const est = size + 200;
    const viable = services.filter(s => s.maxBytes >= est && !failedIds.includes(s.id));
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

  function addLog(msg: string) {
    logs = [...logs, `[${new Date().toLocaleTimeString()}] ${msg}`];
  }

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    file = target.files?.[0] || null;
    tooLarge = !!(file && file.size > MAX_BYTES);
    resultUrl = '';
    resultService = '';
    error = '';
    logs = [];
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
      error = 'No service available for this file size and retention.';
      return;
    }

    if (!password && autoPassword) password = generatePassword();
    if (!password) { error = 'Password is required.'; return; }

    uploading = true;
    error = '';
    resultUrl = '';
    resultService = '';
    logs = [];

    try {
      addLog('Reading file...');
      const fileBuffer = new Uint8Array(await file.arrayBuffer());
      addLog(`File size: ${formatBytes(fileBuffer.length)}`);

      addLog('Encrypting with AES-256-GCM...');
      const encrypted = await encryptData(fileBuffer, password, file.name);
      addLog(`Encrypted: ${formatBytes(encrypted.length)}`);

      const useStego = target.type === 'image';
      const randomId = randomFilename();
      let uploadBlob: Blob;
      let uploadName: string;

      if (useStego) {
        addLog('Creating steganography image...');
        const stegoBuffer = await createStegoImage(encrypted);
        addLog(`Stego image: ${formatBytes(stegoBuffer.length)}`);
        uploadBlob = new Blob([stegoBuffer.buffer as ArrayBuffer], { type: 'image/png' });
        uploadName = `${randomId}.png`;
      } else {
        addLog('Encoding to base64...');
        const b64 = arrayToBase64(encrypted);
        uploadBlob = new Blob([new TextEncoder().encode(b64)], { type: 'text/plain' });
        uploadName = `${randomId}.txt`;
        addLog(`Encoded: ${formatBytes(uploadBlob.size)}`);
      }

      addLog(`Uploading to ${target.name}...`);
      const form = new FormData();
      form.append('file', uploadBlob, uploadName);
      form.append('services', target.id);
      form.append('stego', useStego ? 'true' : 'false');

      const res = await fetch('/api/ghost/upload', { method: 'POST', body: form });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Server error (${res.status})${text ? ': ' + text.slice(0, 200) : ''}`);
      }

      let data: { results?: { service: string; url: string | null; error?: string }[]; error?: string };
      try {
        data = await res.json();
      } catch {
        throw new Error('Server returned an invalid response.');
      }

      if (data.error) throw new Error(data.error);

      const result = data.results?.[0];
      if (!result || !result.url) {
        throw new Error(result?.error || 'Upload returned no URL');
      }

      resultUrl = result.url;
      resultService = target.name;
      addLog(`Uploaded to ${target.name}: ${result.url}`);
    } catch (e: any) {
      failedIds = [...failedIds, target.id];
      const remaining = rankProviders(wantDays, file!.size);
      if (remaining.length > 0) {
        error = `${target.name} failed. Choose an alternative below, or adjust retention.`;
      } else {
        error = `${target.name} failed — no other providers match this retention. Try adjusting the slider.`;
      }
      addLog(`ERROR: ${e?.message || 'Upload failed'}`);
    } finally {
      uploading = false;
    }
  }

  async function handleDecrypt() {
    decryptError = '';
    decryptedFile = null;

    if (!decryptPassword.trim()) { decryptError = 'Password is required.'; return; }
    if (decryptMode === 'url' && !decryptUrl.trim()) { decryptError = 'URL is required.'; return; }
    if (decryptMode === 'file' && !decryptFile) { decryptError = 'File is required.'; return; }

    decrypting = true;
    logs = [];

    try {
      let encryptedData: Uint8Array;
      let isImage = false;

      if (decryptMode === 'url') {
        addLog('Fetching data...');
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
          addLog('Extracting steganography data...');
          const imgBuffer = new Uint8Array(await res.arrayBuffer());
          const extracted = await extractStego(imgBuffer);
          if (!extracted) throw new Error('No hidden data found in image');
          encryptedData = extracted;
        } else {
          const text = await res.text();
          if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().toLowerCase().startsWith('<html')) {
            throw new Error('URL returned an HTML page. Use a direct download link.');
          }
          addLog('Decoding base64...');
          encryptedData = base64ToArray(text);
        }
      } else {
        if (!decryptFile) throw new Error('No file selected');
        isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(decryptFile.name);
        addLog(`Reading: ${decryptFile.name}`);
        const buffer = new Uint8Array(await decryptFile.arrayBuffer());

        if (isImage) {
          addLog('Extracting steganography data...');
          const extracted = await extractStego(buffer);
          if (!extracted) throw new Error('No hidden data found in image');
          encryptedData = extracted;
        } else {
          addLog('Decoding base64...');
          encryptedData = base64ToArray(new TextDecoder().decode(buffer));
        }
      }

      addLog(`Encrypted data: ${formatBytes(encryptedData.length)}`);
      addLog('Decrypting...');
      const decrypted = await decryptData(encryptedData, decryptPassword);
      addLog(`Decrypted: ${decrypted.name} (${formatBytes(decrypted.data.length)})`);

      decryptedFile = { name: decrypted.name || 'decrypted-file', data: decrypted.data };
    } catch (e: any) {
      decryptError = e?.message || 'Decryption failed';
      addLog(`ERROR: ${decryptError}`);
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

  function copyText(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
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
      on:click={() => { mode = 'encrypt'; logs = []; decryptError = ''; decryptedFile = null; }}
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
      on:click={() => { mode = 'decrypt'; logs = []; error = ''; resultUrl = ''; }}
    >
      Decrypt
    </button>
  </div>

  {#if mode === 'encrypt'}
    <div class="card p-6 md:p-8 space-y-6">
      <div class="space-y-3">
        <label for="ghost-file" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          File to encrypt (max 25 MB)
        </label>
        <input id="ghost-file" type="file" class="input cursor-pointer" on:change={handleFileChange} />
        {#if file}
          <p class="text-[11px] text-zinc-500 dark:text-zinc-400">
            Selected: <span class="font-mono">{file.name}</span>
            <span class="opacity-75">— {formatBytes(file.size)}</span>
          </p>
        {/if}
        {#if tooLarge}
          <p class="text-xs text-red-500 font-semibold">File exceeds 25 MB limit.</p>
        {/if}
      </div>

      <div class="space-y-2">
        <label for="ghost-password" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Encryption password
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
            Auto-generate if empty
          </label>
          <button
            type="button"
            class="btn-outline text-[11px] px-3 py-1"
            on:click={() => (password = generatePassword())}
          >
            Generate
          </button>
        </div>
      </div>

      <div class="space-y-3">
        <label class="block text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          File retention: <span class="text-emerald-600 dark:text-emerald-400">{wantLabel}</span>
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
            <span><span class="font-bold">{provider.name}</span>{#if isStego} — steganography mode{/if}</span>
            {#if provider.tosUrl}
              <a href={provider.tosUrl} target="_blank" rel="noopener noreferrer" class="ml-auto text-[10px] text-blue-500 hover:underline shrink-0">TOS</a>
            {/if}
          </div>
          <div class="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
            Keeps your file for {provider.retDays === Infinity ? 'unlimited time' : formatDays(provider.retDays)}{isStego ? ' · data hidden inside a PNG image' : ''}
          </div>
        </div>
      {:else if file && !tooLarge && services.length > 0}
        <div class="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 space-y-2">
          <p class="text-xs text-amber-700 dark:text-amber-400">No provider available for this file size and retention.</p>
          <div class="flex gap-2 flex-wrap">
            {#if nearestShorter !== null}
              <button type="button" class="btn-outline text-[10px] px-3 py-1.5" on:click={() => (retIdx = nearestShorter)}>
                Try {STOPS[nearestShorter].full} instead
              </button>
            {/if}
            {#if nearestLonger !== null}
              <button type="button" class="btn-outline text-[10px] px-3 py-1.5" on:click={() => (retIdx = nearestLonger)}>
                Try {STOPS[nearestLonger].full} instead
              </button>
            {/if}
          </div>
        </div>
      {:else if file && !tooLarge && services.length === 0}
        <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700">
          <p class="text-xs text-zinc-500 dark:text-zinc-400">Loading providers...</p>
        </div>
      {/if}

      <button
        type="button"
        class="btn w-full py-4 uppercase font-black tracking-widest text-xs"
        on:click={() => handleUpload()}
        disabled={!file || tooLarge || uploading || !provider}
      >
        {#if uploading}
          Processing...
        {:else}
          Encrypt &amp; Upload
        {/if}
      </button>

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
                  Try {alt.name} ({alt.type === 'image' ? 'stego' : 'file'}, {alt.retDays === Infinity ? '∞' : formatDays(alt.retDays)})
                </button>
              {/each}
            </div>
          {/if}
          {#if altProviders.length === 0}
            <div class="flex gap-2 flex-wrap">
              {#if nearestShorter !== null}
                <button type="button" class="btn-outline text-[10px] px-3 py-1.5" on:click={() => { retIdx = nearestShorter; failedIds = []; error = ''; }}>
                  Try {STOPS[nearestShorter].full} retention
                </button>
              {/if}
              {#if nearestLonger !== null}
                <button type="button" class="btn-outline text-[10px] px-3 py-1.5" on:click={() => { retIdx = nearestLonger; failedIds = []; error = ''; }}>
                  Try {STOPS[nearestLonger].full} retention
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
          Upload successful — {resultService}
        </h3>
        <div class="flex gap-2 items-center">
          <input type="text" readonly class="input font-mono text-xs flex-1" value={resultUrl} />
          <button type="button" class="btn-outline text-xs" on:click={() => copyText(resultUrl)}>Copy</button>
        </div>
      </div>

      <div class="card p-6 md:p-8 space-y-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
        <h3 class="text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
          Your Encryption Password
        </h3>
        <div class="flex gap-2 items-center">
          <input type="text" readonly class="input font-mono text-xs flex-1 bg-white dark:bg-zinc-900" value={password} />
          <button type="button" class="btn-outline text-xs" on:click={() => copyText(password)}>Copy</button>
        </div>
        <p class="text-[10px] text-amber-600 dark:text-amber-400/80">
          Save this password! Share it through a separate secure channel.
        </p>
      </div>
    {/if}

    {#if logs.length > 0}
      <div class="card p-4 space-y-2">
        <div class="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Log</div>
        <div class="bg-zinc-900 dark:bg-zinc-950 rounded-lg p-3 font-mono text-[11px] text-zinc-300 dark:text-zinc-400 max-h-48 overflow-y-auto">
          {#each logs as log}
            <div>{log}</div>
          {/each}
        </div>
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
          From URL
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
          From File
        </button>
      </div>

      {#if decryptMode === 'url'}
        <div class="space-y-3">
          <label for="decrypt-url" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            URL to encrypted file
          </label>
          <input
            id="decrypt-url"
            type="text"
            class="input font-mono text-sm"
            bind:value={decryptUrl}
            placeholder="https://qu.ax/xxx.txt or https://sxcu.net/xxx.png"
          />
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500">
            Supports base64 text files and steganography images
          </p>
        </div>
      {:else}
        <div class="space-y-3">
          <label for="decrypt-file" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Select encrypted file
          </label>
          <input id="decrypt-file" type="file" class="input cursor-pointer" on:change={handleDecryptFileChange} />
          {#if decryptFile}
            <p class="text-[11px] text-zinc-500 dark:text-zinc-400">
              Selected: <span class="font-mono">{decryptFile.name}</span>
            </p>
          {/if}
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500">
            Supports .txt (base64) and .png/.jpg (steganography)
          </p>
        </div>
      {/if}

      <div class="space-y-3">
        <label for="decrypt-password" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Decryption password
        </label>
        <input
          id="decrypt-password"
          type="text"
          class="input font-mono text-sm"
          bind:value={decryptPassword}
          placeholder="Enter the password used for encryption"
        />
      </div>

      <button
        type="button"
        class="btn w-full py-4 uppercase font-black tracking-widest text-xs"
        on:click={handleDecrypt}
        disabled={decrypting}
      >
        {#if decrypting}
          Decrypting...
        {:else}
          Decrypt File
        {/if}
      </button>

      {#if decryptError}
        <p class="text-xs text-red-500">{decryptError}</p>
      {/if}

      {#if decryptedFile}
        <div class="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
          <div class="flex items-center gap-3">
            <div class="flex-1">
              <div class="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Decrypted successfully!</div>
              <div class="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">{decryptedFile.name} — {formatBytes(decryptedFile.data.length)}</div>
            </div>
            <button type="button" class="btn text-xs" on:click={downloadDecrypted}>
              Download
            </button>
          </div>
        </div>
      {/if}
    </div>

    {#if logs.length > 0}
      <div class="card p-4 space-y-2">
        <div class="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Log</div>
        <div class="bg-zinc-900 dark:bg-zinc-950 rounded-lg p-3 font-mono text-[11px] text-zinc-300 dark:text-zinc-400 max-h-48 overflow-y-auto">
          {#each logs as log}
            <div>{log}</div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
