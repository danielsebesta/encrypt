<script lang="ts">
  import { onMount } from 'svelte';
  import { encrypt, decrypt } from '../../lib/crypto';
  import { encryptData } from '../../lib/ghost/crypto';
  import { createStegoImage } from '../../lib/ghost/steganography';
  import CopyButton from '../CopyButton.svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  type Step = 'input' | 'processing' | 'result';
  type DeliveryMode = 'auto' | 'link' | 'ghost';
  type ShortProvider = 'nolog' | '1url' | 'urlvanish' | 'tini' | 'choto' | 'isgd';

  let step: Step = 'input';

  let textInput = '';
  let file: File | null = null;
  let password = '';
  let autoPassword = true;
  let enableStego = false;
  let enableTimelock = false;
  let timelockDate = '';
  let shortMode: ShortProvider = 'nolog';
  let showAdvanced = false;

  let logs: string[] = [];
  let resultUrl = '';
  let shortUrl = '';
  let stegoImageUrl = '';
  let stegoImageBlob: Blob | null = null;
  let error = '';
  let shortError = '';
  let shortLoading = false;

  const INLINE_LIMIT = 10 * 1024;
  const MAX_FILE = 25 * 1024 * 1024;
  const STEGO_THRESHOLD = 500 * 1024;

  // Hosts that return direct download URLs (not download pages)
  // Ordered by preference: long retention first, then reliability
  const DIRECT_FILE_HOSTS = ['quax', 'tmpfile', 'tempsh', 'uguu'];
  const DIRECT_IMAGE_HOSTS = ['sxcu', 'freeimage', 'imgbb', 'lightshot', 'imghippo'];

  interface HostInfo { id: string; name: string; retention: string; }
  const HOST_INFO: Record<string, HostInfo> = {
    quax: { id: 'quax', name: 'qu.ax', retention: '30 days' },
    tmpfile: { id: 'tmpfile', name: 'tmpfile.link', retention: '7 days' },
    tempsh: { id: 'tempsh', name: 'temp.sh', retention: '3 days' },
    uguu: { id: 'uguu', name: 'Uguu.se', retention: '3 hours' },
    sxcu: { id: 'sxcu', name: 'sxcu.net', retention: 'forever' },
    freeimage: { id: 'freeimage', name: 'FreeImage.host', retention: 'forever' },
    imgbb: { id: 'imgbb', name: 'ImgBB', retention: 'forever' },
    lightshot: { id: 'lightshot', name: 'Lightshot', retention: 'forever' },
    imghippo: { id: 'imghippo', name: 'ImgHippo', retention: '72 hours' },
  };

  $: payloadSize = file ? file.size : new TextEncoder().encode(textInput.trim()).byteLength;
  $: isLarge = payloadSize > INLINE_LIMIT;
  $: deliveryMode = isLarge ? 'ghost' : 'link';
  $: providerName = shortMode === '1url' ? '1url.cz' : shortMode === 'urlvanish' ? 'URLVanish' : shortMode === 'tini' ? 'tini.fyi' : shortMode === 'choto' ? 'choto.co' : shortMode === 'isgd' ? 'is.gd' : 'Nolog.link';

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

  function log(msg: string) {
    logs = [...logs, `${new Date().toLocaleTimeString()} — ${msg}`];
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

  async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function handleEncrypt() {
    error = '';
    logs = [];
    resultUrl = '';
    shortUrl = '';
    shortError = '';
    stegoImageUrl = '';
    stegoImageBlob = null;

    const trimmed = textInput.trim();
    if (!file && !trimmed) {
      error = 'Enter a message or select a file.';
      return;
    }
    if (file && file.size > MAX_FILE) {
      error = `File exceeds ${Math.round(MAX_FILE / (1024 * 1024))} MB limit.`;
      return;
    }

    if (autoPassword) {
      password = generatePassword();
    }
    if (!password) {
      error = 'Password is required.';
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
      error = e?.message || 'Encryption failed.';
      step = 'input';
    }
  }

  async function encryptInline() {
    log('Preparing payload...');
    let payload: any;
    if (file) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const b64 = btoa(String.fromCharCode(...bytes));
      payload = { v: 1, mode: 'inline', kind: 'file', name: file.name, type: file.type || 'application/octet-stream', data: b64 };
    } else {
      payload = { v: 1, mode: 'inline', kind: 'text', text: textInput.trim() };
    }

    log('Encrypting with AES-256-GCM...');
    const json = JSON.stringify(payload);
    const jsonBytes = new TextEncoder().encode(json);
    const compressed = await gzipBytes(jsonBytes);
    const compressedB64 = bytesToBase64(compressed);
    const encrypted = await encrypt(compressedB64, password);
    const encoded = base64UrlEncode(encrypted);

    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';
    resultUrl = `${origin}/u#${encoded}`;
    log('Link generated.');

    if (enableStego) {
      await wrapInStego(resultUrl);
    }
  }

  async function encryptGhost() {
    log('Reading file...');
    let buffer: Uint8Array;
    let filename: string;

    if (file) {
      buffer = new Uint8Array(await file.arrayBuffer());
      filename = file.name;
    } else {
      buffer = new TextEncoder().encode(textInput.trim());
      filename = 'message.txt';
    }

    log('Encrypting with AES-256-GCM...');
    const encrypted = await encryptData(buffer, password, filename);

    let uploadBytes: Uint8Array;
    let uploadFilename: string;
    let usedStego = false;

    if (encrypted.length <= STEGO_THRESHOLD) {
      log('Wrapping in steganography image...');
      uploadBytes = await createStegoImage(encrypted);
      uploadFilename = 'ghost.png';
      usedStego = true;
    } else {
      uploadBytes = encrypted;
      uploadFilename = 'ghost.bin';
    }

    // Try hosts one by one (not all at once) to avoid bans
    const hostQueue = usedStego
      ? [...DIRECT_IMAGE_HOSTS, ...DIRECT_FILE_HOSTS]
      : [...DIRECT_FILE_HOSTS, ...DIRECT_IMAGE_HOSTS];

    let uploadUrl = '';
    let uploadHost = '';

    for (const hostId of hostQueue) {
      const info = HOST_INFO[hostId];
      if (!info) continue;
      log(`Uploading to ${info.name} (${info.retention})...`);
      try {
        const res = await fetch(`/api/ghost/upload?services=${hostId}&stego=${usedStego}&filename=${encodeURIComponent(uploadFilename)}`, {
          method: 'POST',
          body: uploadBytes,
        });
        if (!res.ok) {
          log(`${info.name}: HTTP ${res.status}, trying next...`);
          continue;
        }
        const data = await res.json() as any;
        const result = data?.results?.[0];
        if (result?.url) {
          uploadUrl = result.url;
          uploadHost = info.name;
          log(`Uploaded to ${info.name} (${info.retention}).`);
          break;
        }
        log(`${info.name}: ${result?.error || 'no URL returned'}, trying next...`);
      } catch (e: any) {
        log(`${info.name}: ${e?.message || 'network error'}, trying next...`);
      }
    }

    if (!uploadUrl) {
      throw new Error('All upload hosts failed.');
    }

    const ghostPayload = {
      v: 1,
      mode: 'ghost',
      url: uploadUrl,
      stego: usedStego,
    };

    log('Encoding link...');
    const payloadJson = JSON.stringify(ghostPayload);
    const payloadBytes = new TextEncoder().encode(payloadJson);
    const compressed = await gzipBytes(payloadBytes);
    const compressedB64 = bytesToBase64(compressed);
    const encPayload = await encrypt(compressedB64, password);
    const encoded = base64UrlEncode(encPayload);

    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';
    resultUrl = `${origin}/u#${encoded}`;
    log('Link generated.');

    if (enableStego) {
      await wrapInStego(resultUrl);
    }
  }

  async function wrapInStego(url: string) {
    log('Hiding link in steganography image...');
    const urlBytes = new TextEncoder().encode(url);
    const stegoBytes = await createStegoImage(urlBytes);
    stegoImageBlob = new Blob([stegoBytes], { type: 'image/png' });
    stegoImageUrl = URL.createObjectURL(stegoImageBlob);
    log('Stego image created.');
  }

  async function handleShorten() {
    if (!resultUrl) return;
    shortError = '';
    shortUrl = '';
    shortLoading = true;
    try {
      const res = await fetch('/api/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: resultUrl, provider: shortMode })
      });
      const data = await res.json();
      if (!res.ok || !data?.shorturl) {
        shortError = data?.error || 'Shortening failed.';
        return;
      }
      shortUrl = data.shorturl;
    } catch (e: any) {
      shortError = e?.message || 'Shortening failed.';
    } finally {
      shortLoading = false;
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
    logs = [];
    resultUrl = '';
    shortUrl = '';
    shortError = '';
    error = '';
    showAdvanced = false;
    if (stegoImageUrl) URL.revokeObjectURL(stegoImageUrl);
    stegoImageUrl = '';
    stegoImageBlob = null;
  }

  onMount(() => {});
</script>

<div class="space-y-6 text-left">
  {#if step === 'input'}
    <div class="space-y-5">
      <div class="space-y-2">
        <label class="label block" for="ue-text">Message</label>
        <textarea
          id="ue-text"
          class="input min-h-[100px] resize-vertical font-mono text-xs"
          bind:value={textInput}
          placeholder="Type a secret message..."
          disabled={!!file}
        ></textarea>
      </div>

      <div class="space-y-2">
        <label class="label block" for="ue-file">Or attach a file</label>
        {#if file}
          <div class="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <span class="text-xs font-mono truncate flex-1">{file.name} <span class="text-zinc-400">({(file.size / 1024).toFixed(1)} KB)</span></span>
            <button type="button" class="text-[10px] font-bold text-red-500 hover:underline" on:click={clearFile}>REMOVE</button>
          </div>
        {:else}
          <input id="ue-file" type="file" class="input cursor-pointer text-xs" on:change={handleFileChange} />
        {/if}
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="label block" for="ue-pass">Password</label>
          <label class="inline-flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" bind:checked={autoPassword} class="accent-emerald-500" />
            Auto-generate
          </label>
        </div>
        {#if autoPassword}
          <p class="text-[11px] text-zinc-400 italic">A strong password will be generated automatically.</p>
        {:else}
          <input
            id="ue-pass"
            type="password"
            class="input"
            bind:value={password}
            autocomplete="new-password"
            placeholder="Enter a strong password"
          />
        {/if}
      </div>

      {#if payloadSize > 0}
        <div class="flex items-center gap-2 text-[10px] text-zinc-400">
          <span class="font-bold uppercase tracking-widest">Mode:</span>
          {#if isLarge}
            <span class="text-amber-500">Encrypted upload ({(payloadSize / 1024).toFixed(1)} KB)</span>
          {:else}
            <span class="text-emerald-500">Direct link ({payloadSize} bytes)</span>
          {/if}
        </div>
      {/if}

      <details class="text-xs" bind:open={showAdvanced}>
        <summary class="cursor-pointer select-none text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 font-bold uppercase tracking-widest text-[10px]">Advanced options</summary>
        <div class="mt-4 space-y-3 pl-1">
          <label class="flex items-center gap-2 cursor-pointer select-none text-zinc-500 dark:text-zinc-400">
            <input type="checkbox" bind:checked={enableStego} class="accent-emerald-500" />
            <span>Hide link in a steganography image</span>
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
        Encrypt & Share
      </button>
    </div>

  {:else if step === 'processing'}
    <div class="space-y-4">
      <div class="space-y-1">
        {#each logs as entry}
          <p class="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">{entry}</p>
        {/each}
      </div>
      <div class="flex items-center gap-2 text-xs text-emerald-500">
        <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Processing...
      </div>
      {#if error}
        <p class="text-xs text-red-500">{error}</p>
      {/if}
    </div>

  {:else if step === 'result'}
    <div class="space-y-5">
      <div class="space-y-1">
        {#each logs as entry}
          <p class="text-[11px] font-mono text-zinc-400">{entry}</p>
        {/each}
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="label block">Encrypted link</label>
          <CopyButton text={resultUrl} label="COPY" />
        </div>
        <input class="input text-xs font-mono" type="text" readonly value={resultUrl} />
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="label block">Password</label>
          <CopyButton text={password} label="COPY" />
        </div>
        <input class="input text-xs font-mono" type="text" readonly value={password} />
        <p class="text-[10px] text-amber-500">Share this password separately — never in the same channel as the link.</p>
      </div>

      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <label class="uppercase font-bold tracking-widest" for="ue-shortener">Shortener</label>
            <select
              id="ue-shortener"
              class="input !h-7 !py-0 !text-[11px] !px-2"
              bind:value={shortMode}
            >
              <option value="nolog">Nolog.link</option>
              <option value="tini">tini.fyi</option>
              <option value="urlvanish">URLVanish</option>
              <option value="choto">choto.co</option>
              <option value="1url">1url.cz</option>
              <option value="isgd">is.gd</option>
            </select>
          </div>
          <button
            type="button"
            class="btn-outline text-xs"
            on:click={handleShorten}
            disabled={shortLoading}
          >
            {shortLoading ? 'Shortening...' : 'Shorten'}
          </button>
        </div>
        {#if shortError}
          <p class="text-xs text-red-500">{shortError}</p>
        {/if}
        {#if shortUrl}
          <div class="space-y-1">
            <p class="text-[11px] text-amber-600 dark:text-amber-400">
              Shortened via {providerName} — the shortener can see the link (not the content).
            </p>
            <div class="flex items-center gap-2">
              <input class="input text-xs font-mono flex-1" type="text" readonly value={shortUrl} />
              <CopyButton text={shortUrl} label="COPY" />
            </div>
          </div>
        {/if}
      </div>

      {#if stegoImageUrl}
        <div class="space-y-2">
          <label class="label block">Steganography image</label>
          <p class="text-[11px] text-zinc-400">The encrypted link is hidden inside this image. Share it instead of the URL.</p>
          <div class="flex items-center gap-3">
            <img src={stegoImageUrl} alt="Stego" class="w-16 h-16 rounded border border-zinc-200 dark:border-zinc-800 object-cover" />
            <button type="button" class="btn-outline text-xs" on:click={downloadStego}>Download image</button>
          </div>
        </div>
      {/if}

      <button type="button" class="btn-outline w-full text-xs" on:click={reset}>Encrypt another</button>
    </div>
  {/if}
</div>
