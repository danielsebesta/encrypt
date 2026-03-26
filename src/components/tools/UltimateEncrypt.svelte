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

  let logs: string[] = [];
  let resultUrl = '';
  let shortUrl = '';
  let stegoImageUrl = '';
  let stegoImageBlob: Blob | null = null;
  let error = '';

  const INLINE_LIMIT = 10 * 1024;
  const MAX_FILE = 25 * 1024 * 1024;
  const STEGO_THRESHOLD = 500 * 1024;

  // BINARY chain: raw file hosts only (no re-encoding risk)
  // Ordered by reliability + retention
  interface HostInfo { id: string; name: string; retention: string; maxBytes: number; }
  const BINARY_HOSTS: HostInfo[] = [
    { id: 'quax', name: 'qu.ax', retention: '30 days', maxBytes: 256 * 1024 * 1024 },
    { id: '0x0', name: '0x0.st', retention: '30 days', maxBytes: 512 * 1024 * 1024 },
    { id: 'catbox', name: 'Catbox.moe', retention: 'forever', maxBytes: 200 * 1024 * 1024 },
    { id: 'transfersh', name: 'transfer.sh', retention: '14 days', maxBytes: 10 * 1024 * 1024 * 1024 },
    { id: 'tmpfile', name: 'tmpfile.link', retention: '7 days', maxBytes: 100 * 1024 * 1024 },
    { id: 'tempsh', name: 'temp.sh', retention: '3 days', maxBytes: 4 * 1024 * 1024 * 1024 },
    { id: 'uguu', name: 'Uguu.se', retention: '3 hours', maxBytes: 128 * 1024 * 1024 },
  ];

  // IMAGE chain: for stego PNGs only (these hosts accept images natively)
  const IMAGE_HOSTS: HostInfo[] = [
    { id: 'sxcu', name: 'sxcu.net', retention: 'forever', maxBytes: 95 * 1024 * 1024 },
    { id: 'freeimage', name: 'FreeImage.host', retention: 'forever', maxBytes: 64 * 1024 * 1024 },
    { id: 'imgbb', name: 'ImgBB', retention: 'forever', maxBytes: 32 * 1024 * 1024 },
    { id: 'lightshot', name: 'Lightshot', retention: 'forever', maxBytes: 20 * 1024 * 1024 },
    { id: 'imghippo', name: 'ImgHippo', retention: '72 hours', maxBytes: 20 * 1024 * 1024 },
  ];

  $: payloadSize = file ? file.size : new TextEncoder().encode(textInput.trim()).byteLength;
  $: isLarge = payloadSize > INLINE_LIMIT;
  $: deliveryMode = isLarge ? 'ghost' : 'link';


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
    await autoShorten(resultUrl);

    if (enableStego) {
      await wrapInStego(shortUrl || resultUrl);
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

    // Use image hosts for stego PNGs, binary hosts for everything else
    // Filter by file size, try one at a time
    const chain = usedStego ? IMAGE_HOSTS : BINARY_HOSTS;
    const eligible = chain.filter(h => uploadBytes.length <= h.maxBytes);

    let uploadUrl = '';

    for (const host of eligible) {
      log(`Uploading to ${host.name} (${host.retention})...`);
      try {
        const res = await fetch(`/api/ghost/upload?services=${host.id}&stego=${usedStego}&filename=${encodeURIComponent(uploadFilename)}`, {
          method: 'POST',
          body: uploadBytes,
        });
        if (!res.ok) {
          log(`${host.name}: HTTP ${res.status}, trying next...`);
          continue;
        }
        const data = await res.json() as any;
        const result = data?.results?.[0];
        if (result?.url) {
          uploadUrl = result.url;
          log(`Uploaded to ${host.name} (${host.retention}).`);
          break;
        }
        log(`${host.name}: ${result?.error || 'no URL returned'}, trying next...`);
      } catch (e: any) {
        log(`${host.name}: ${e?.message || 'network error'}, trying next...`);
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
    await autoShorten(resultUrl);

    if (enableStego) {
      await wrapInStego(shortUrl || resultUrl);
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
      const res = await fetch('/api/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, provider }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (res.ok && data?.shorturl) return data.shorturl;
    } catch {} finally {
      clearTimeout(timer);
    }
    return null;
  }

  async function autoShorten(url: string): Promise<void> {
    // Try primary providers (privacy-first)
    for (const provider of PRIMARY_SHORT) {
      log(`Shortening via ${SHORT_NAMES[provider]}...`);
      const result = await tryShorten(url, provider);
      if (result) { shortUrl = result; log(`Shortened via ${SHORT_NAMES[provider]}.`); return; }
      // Retry once
      const retry = await tryShorten(url, provider);
      if (retry) { shortUrl = retry; log(`Shortened via ${SHORT_NAMES[provider]} (retry).`); return; }
    }
    // Fallback providers
    log('Primary shorteners unavailable, trying fallbacks...');
    for (const provider of FALLBACK_SHORT) {
      const result = await tryShorten(url, provider);
      if (result) { shortUrl = result; log(`Shortened via ${SHORT_NAMES[provider]}.`); return; }
    }
    log('All shorteners failed — using full link.');
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
          <label class="label block">{shortUrl ? 'Share this link' : 'Encrypted link'}</label>
          <CopyButton text={shortUrl || resultUrl} label="COPY" />
        </div>
        <input class="input text-xs font-mono" type="text" readonly value={shortUrl || resultUrl} />
        {#if shortUrl}
          <details class="text-[11px] text-zinc-400">
            <summary class="cursor-pointer select-none hover:text-zinc-600 dark:hover:text-zinc-300">Full link</summary>
            <div class="mt-1 flex items-center gap-2">
              <input class="input text-[10px] font-mono flex-1" type="text" readonly value={resultUrl} />
              <CopyButton text={resultUrl} label="COPY" className="!text-[9px]" />
            </div>
          </details>
        {/if}
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="label block">Password</label>
          <CopyButton text={password} label="COPY" />
        </div>
        <input class="input text-xs font-mono" type="text" readonly value={password} />
        <p class="text-[10px] text-amber-500">Share this password separately — never in the same channel as the link.</p>
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
