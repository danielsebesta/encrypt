<script lang="ts">
  import { onMount } from 'svelte';
  import { encryptData, decryptData } from '../../lib/ghost/crypto';
  import { createStegoImage, extractStego } from '../../lib/ghost/steganography';

  const MAX_BYTES = 25 * 1024 * 1024;

  interface ServiceInfo {
    id: string;
    name: string;
    type: 'image' | 'file';
    maxBytes: number;
    retention: string;
    tosUrl: string | null;
    recommended?: boolean;
  }

  type UploadResult = { service: string; url: string | null; error?: string };

  let mode: 'encrypt' | 'decrypt' = 'encrypt';
  let decryptMode: 'url' | 'file' = 'url';
  
  let file: File | null = null;
  let password = '';
  let autoPassword = true;
  let services: ServiceInfo[] = [];
  let selectedServices: string[] = [];
  let tooLarge = false;

  let encrypting = false;
  let uploading = false;
  let results: UploadResult[] = [];
  let error = '';
  let logs: string[] = [];

  // Decrypt tab
  let decryptUrl = '';
  let decryptPassword = '';
  let decryptFile: File | null = null;
  let decrypting = false;
  let decryptError = '';
  let decryptedFile: { name: string; data: Uint8Array } | null = null;

  $: successCount = results.filter(r => r.url).length;
  $: failCount = results.filter(r => !r.url).length;

  function formatBytes(bytes: number): string {
    if (bytes === Infinity) return '∞';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/ghost/upload');
      const data = await res.json() as { services: ServiceInfo[] };
      services = data.services || [];
      selectedServices = services.filter(s => s.recommended).map(s => s.id);
    } catch {
      services = [];
    }
  });

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString();
    logs.push(`[${ts}] ${msg}`);
    logs = logs;
  }

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const f = target.files && target.files[0] ? target.files[0] : null;
    file = f;
    results = [];
    error = '';
    logs = [];
    decryptedFile = null;
    tooLarge = !!(f && f.size > MAX_BYTES);
  }

  function handleDecryptFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    decryptFile = target.files && target.files[0] ? target.files[0] : null;
    decryptError = '';
    decryptedFile = null;
  }

  function generateRandomPassword(length = 32): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~';
    let out = '';
    for (let i = 0; i < length; i++) {
      out += chars[bytes[i] % chars.length];
    }
    return out;
  }

  function generateRandomFilename(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function toggleService(id: string) {
    if (selectedServices.includes(id)) {
      selectedServices = selectedServices.filter(s => s !== id);
    } else {
      selectedServices = [...selectedServices, id];
    }
  }

  function selectRecommended() {
    selectedServices = services.filter(s => s.recommended).map(s => s.id);
  }

  function selectAll() {
    selectedServices = services.map(s => s.id);
  }

  function clearSelection() {
    selectedServices = [];
  }

  function arrayToBase64(arr: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < arr.length; i++) {
      binary += String.fromCharCode(arr[i]);
    }
    return btoa(binary);
  }

  function base64ToArray(b64: string): Uint8Array {
    const cleaned = b64.replace(/[^A-Za-z0-9+/=]/g, '').trim();
    const padded = cleaned.padEnd(Math.ceil(cleaned.length / 4) * 4, '=');
    const binary = atob(padded);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      arr[i] = binary.charCodeAt(i);
    }
    return arr;
  }

  async function handleUpload() {
    if (!file) return;
    if (tooLarge || selectedServices.length === 0) return;

    if (!password && autoPassword) {
      password = generateRandomPassword(32);
    }
    if (!password) {
      error = 'Password is required.';
      return;
    }

    results = [];
    error = '';
    logs = [];

    try {
      addLog('Reading file...');
      const fileBuffer = new Uint8Array(await file.arrayBuffer());
      addLog(`File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);

      addLog('Encrypting with AES-256-GCM...');
      const encrypted = await encryptData(fileBuffer, password, file.name);
      addLog(`Encrypted size: ${(encrypted.length / 1024).toFixed(2)} KB`);

      const imageIds = selectedServices.filter(id => services.find(s => s.id === id)?.type === 'image');
      const fileIds = selectedServices.filter(id => services.find(s => s.id === id)?.type === 'file');

      let stegoBuffer: Uint8Array | null = null;
      if (imageIds.length > 0) {
        addLog('Creating steganography image...');
        stegoBuffer = await createStegoImage(encrypted);
        addLog(`Stego image size: ${(stegoBuffer.length / 1024).toFixed(2)} KB`);
      }

      let txtBuffer: Uint8Array | null = null;
      if (fileIds.length > 0) {
        addLog('Encoding encrypted data to base64...');
        const base64Data = arrayToBase64(encrypted);
        txtBuffer = new TextEncoder().encode(base64Data);
        addLog(`Base64 txt size: ${(txtBuffer.length / 1024).toFixed(2)} KB`);
      }

      addLog(`Uploading to ${selectedServices.length} services...`);

      const allResults: UploadResult[] = [];
      const randomId = generateRandomFilename();

      if (stegoBuffer && imageIds.length > 0) {
        addLog(`Uploading stego image to ${imageIds.length} hosts...`);
        const form = new FormData();
        form.append('file', new Blob([stegoBuffer.buffer as ArrayBuffer], { type: 'image/png' }), `${randomId}.png`);
        form.append('services', imageIds.join(','));
        form.append('stego', 'true');

        const res = await fetch('/api/ghost/upload', { method: 'POST', body: form });
        const data = await res.json() as { results?: UploadResult[]; error?: string };
        if (data.results) {
          allResults.push(...data.results);
          data.results.forEach(r => {
            if (r.url) addLog(`✓ ${getServiceName(r.service)}: ${r.url}`);
            else addLog(`✗ ${getServiceName(r.service)}: ${r.error || 'failed'}`);
          });
        }
      }

      if (txtBuffer && fileIds.length > 0) {
        addLog(`Uploading base64 txt to ${fileIds.length} hosts...`);
        const form = new FormData();
        form.append('file', new Blob([txtBuffer.buffer as ArrayBuffer], { type: 'text/plain' }), `${randomId}.txt`);
        form.append('services', fileIds.join(','));
        form.append('stego', 'false');

        const res = await fetch('/api/ghost/upload', { method: 'POST', body: form });
        const data = await res.json() as { results?: UploadResult[]; error?: string };
        if (data.results) {
          allResults.push(...data.results);
          data.results.forEach(r => {
            if (r.url) addLog(`✓ ${getServiceName(r.service)}: ${r.url}`);
            else addLog(`✗ ${getServiceName(r.service)}: ${r.error || 'failed'}`);
          });
        }
      }

      results = allResults;
      addLog(`Done! ${successCount} succeeded, ${failCount} failed.`);
    } catch (e: any) {
      error = e?.message || 'Upload failed';
      addLog(`ERROR: ${error}`);
    }
  }

  async function handleDecrypt() {
    decryptError = '';
    decryptedFile = null;

    if (!decryptPassword.trim()) {
      decryptError = 'Password is required.';
      return;
    }

    if (decryptMode === 'url' && !decryptUrl.trim()) {
      decryptError = 'URL is required.';
      return;
    }

    if (decryptMode === 'file' && !decryptFile) {
      decryptError = 'File is required.';
      return;
    }

    decrypting = true;

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
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        if (isImage) {
          addLog('Downloading image...');
          const imgBuffer = new Uint8Array(await res.arrayBuffer());
          addLog('Extracting steganography data...');
          const extracted = await extractStego(imgBuffer);
          if (!extracted) throw new Error('No hidden data found in image');
          encryptedData = extracted;
        } else {
          addLog('Decoding base64 from text file...');
          const text = await res.text();
          if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().toLowerCase().startsWith('<html')) {
            throw new Error('URL returned HTML page. Use direct download link.');
          }
          encryptedData = base64ToArray(text);
        }
      } else {
        if (!decryptFile) throw new Error('No file selected');
        isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(decryptFile.name);
        addLog(`Reading file: ${decryptFile.name}`);
        const buffer = new Uint8Array(await decryptFile.arrayBuffer());

        if (isImage) {
          addLog('Extracting steganography data...');
          const extracted = await extractStego(buffer);
          if (!extracted) throw new Error('No hidden data found in image');
          encryptedData = extracted;
        } else {
          addLog('Decoding base64 from text file...');
          const text = new TextDecoder().decode(buffer);
          encryptedData = base64ToArray(text);
        }
      }

      addLog(`Encrypted data: ${(encryptedData.length / 1024).toFixed(2)} KB`);
      addLog('Decrypting...');
      const decrypted = await decryptData(encryptedData, decryptPassword);
      addLog(`Decrypted: ${(decrypted.data.length / 1024).toFixed(2)} KB`);
      addLog(`Original filename: ${decrypted.name || 'unknown'}`);

      decryptedFile = { name: decrypted.name || 'decrypted-file', data: decrypted.data };
      addLog('Decryption successful!');
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

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).catch(() => {});
  }

  function copyAllUrls() {
    const urls = results.filter(r => r.url).map(r => r.url).join('\n');
    navigator.clipboard.writeText(urls).catch(() => {});
  }

  function getServiceName(id: string): string {
    return services.find(s => s.id === id)?.name || id;
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
      on:click={() => { mode = 'decrypt'; logs = []; error = ''; results = []; }}
    >
      Decrypt
    </button>
  </div>

  {#if mode === 'encrypt'}
    <div class="card p-6 md:p-8 space-y-6">
      <div class="space-y-3">
        <label for="ghost-file" class="block text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          File to encrypt &amp; upload (max 25 MB)
        </label>
        <input id="ghost-file" type="file" class="input cursor-pointer" on:change={handleFileChange} />
        {#if file}
          <p class="text-[11px] text-zinc-500 dark:text-zinc-400">
            Selected: <span class="font-mono">{file.name}</span>
            <span class="opacity-75">— {(file.size / (1024 * 1024)).toFixed(2)} MB</span>
          </p>
        {/if}
        {#if tooLarge}
          <p class="text-xs text-red-500 font-semibold">
            File exceeds 25 MB limit. Please choose a smaller file.
          </p>
        {/if}
      </div>

      <div class="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-end">
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
              on:click={() => (password = generateRandomPassword(32))}
            >
              Generate strong password
            </button>
          </div>
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <label class="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Upload Services ({selectedServices.length} selected)
          </label>
          <div class="flex gap-2 text-[10px]">
            <button type="button" class="text-emerald-600 dark:text-emerald-400 hover:underline" on:click={selectRecommended}>Recommended</button>
            <button type="button" class="text-zinc-500 dark:text-zinc-400 hover:underline" on:click={selectAll}>All</button>
            <button type="button" class="text-zinc-400 hover:underline" on:click={clearSelection}>Clear</button>
          </div>
        </div>

        <div class="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 text-[11px] text-blue-700 dark:text-blue-300">
          <strong>Image hosts</strong> embed data in PNG via steganography · <strong>File hosts</strong> use base64 text
        </div>

        <div class="space-y-2 max-h-[400px] overflow-y-auto">
          {#each services as service}
            <button
              type="button"
              on:click={() => toggleService(service.id)}
              class="w-full text-left px-4 py-3 rounded-lg border text-[11px] transition-all {selectedServices.includes(service.id) ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40' : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-600'}"
            >
              <div class="flex items-center gap-2">
                {#if service.recommended}
                  <span class="text-[9px] bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-bold">REC</span>
                {/if}
                <span class="font-semibold {selectedServices.includes(service.id) ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-700 dark:text-zinc-300'}">{service.name}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded {service.type === 'image' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}">{service.type}</span>
              </div>
              <div class="flex items-center gap-3 mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                <span>Retention: {service.retention}</span>
                {#if service.tosUrl}
                  <a href={service.tosUrl} target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline" on:click|stopPropagation>TOS</a>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </div>

      <button
        type="button"
        class="btn w-full py-4 uppercase font-black tracking-widest text-xs"
        on:click={handleUpload}
        disabled={!file || tooLarge || encrypting || uploading || selectedServices.length === 0}
      >
        {#if encrypting || uploading}
          Processing...
        {:else}
          Encrypt &amp; Upload to {selectedServices.length} {selectedServices.length === 1 ? 'Service' : 'Services'}
        {/if}
      </button>

      {#if error}
        <p class="text-xs text-red-500">{error}</p>
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

    {#if results.length > 0}
      <div class="card p-6 md:p-8 space-y-4">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Upload Results
          </h3>
          <div class="flex items-center gap-3 text-[11px]">
            <span class="text-emerald-600 dark:text-emerald-400">{successCount} succeeded</span>
            {#if failCount > 0}
              <span class="text-red-500">{failCount} failed</span>
            {/if}
          </div>
        </div>

        <div class="space-y-2 max-h-[300px] overflow-y-auto">
          {#each results as result}
            <div class="flex items-center gap-3 p-3 rounded-lg border {result.url ? 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900' : 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20'}">
              <div class="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center {result.url ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/50 text-red-500'}">
                {#if result.url}
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                {/if}
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">{getServiceName(result.service)}</div>
                {#if result.url}
                  <div class="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 truncate">{result.url}</div>
                {:else if result.error}
                  <div class="text-[10px] text-red-500">{result.error}</div>
                {:else}
                  <div class="text-[10px] text-red-500">Upload failed</div>
                {/if}
              </div>
              {#if result.url}
                <button
                  type="button"
                  class="btn-outline text-[10px] px-2 py-1 flex-shrink-0"
                  on:click={() => copyUrl(result.url!)}
                >
                  Copy
                </button>
              {/if}
            </div>
          {/each}
        </div>

        {#if successCount > 0}
          <div class="flex gap-2 pt-2">
            <button type="button" class="btn-outline text-xs flex-1" on:click={copyAllUrls}>
              Copy All URLs
            </button>
          </div>
        {/if}
      </div>
    {/if}

    {#if password && results.length > 0}
      <div class="card p-6 md:p-8 space-y-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
        <h3 class="text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
          Your Encryption Password
        </h3>
        <div class="flex gap-2 items-center">
          <input
            type="text"
            readonly
            class="input font-mono text-xs flex-1 bg-white dark:bg-zinc-900"
            value={password}
          />
          <button type="button" class="btn-outline text-xs" on:click={() => copyUrl(password)}>
            Copy
          </button>
        </div>
        <p class="text-[10px] text-amber-600 dark:text-amber-400/80">
          Save this password! Recipients will need it to decrypt the file.
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
            placeholder="https://qu.ax/xxx.txt or https://i.ibb.co/xxx.png"
          />
          <p class="text-[10px] text-zinc-400 dark:text-zinc-500">
            Supports base64 .txt files and steganography images
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
              <div class="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">{decryptedFile.name} — {(decryptedFile.data.length / 1024).toFixed(2)} KB</div>
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
