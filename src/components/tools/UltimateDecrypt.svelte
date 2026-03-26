<script lang="ts">
  import { onMount } from 'svelte';
  import { decrypt } from '../../lib/crypto';
  import { decryptData } from '../../lib/ghost/crypto';
  import { extractStego } from '../../lib/ghost/steganography';
  import CopyButton from '../CopyButton.svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  let password = '';
  let error = '';
  let loading = false;
  let logs: string[] = [];

  let hashPayload = '';
  let hasHash = false;

  let openedText = '';
  let openedFileName = '';
  let openedFileUrl = '';

  let stegoFile: File | null = null;
  let manualMode = false;

  function log(msg: string) {
    logs = [...logs, `${new Date().toLocaleTimeString()} — ${msg}`];
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
    if (hash.length > 1) {
      hasHash = true;
      hashPayload = decodeURIComponent(hash.slice(1));
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
    logs = [];
    if (openedFileUrl) {
      URL.revokeObjectURL(openedFileUrl);
      openedFileUrl = '';
    }

    if (!password) {
      error = 'Password is required.';
      return;
    }

    loading = true;
    try {
      if (stegoFile && !hasHash) {
        await decryptFromStego();
      } else if (hashPayload) {
        await decryptFromHash();
      } else {
        error = 'No encrypted data found. Open a valid /u#... link or upload a stego image.';
      }
    } catch (e: any) {
      console.error('Decrypt error', e);
      error = 'Decryption failed. Wrong password or corrupted data.';
    } finally {
      loading = false;
    }
  }

  async function decryptFromStego() {
    log('Reading steganography image...');
    const buffer = new Uint8Array(await stegoFile!.arrayBuffer());
    const extracted = await extractStego(buffer);
    if (!extracted) {
      throw new Error('No hidden data found in image.');
    }

    const text = new TextDecoder().decode(extracted);

    if (text.startsWith('http')) {
      log('Found hidden URL, following link...');
      const url = new URL(text);
      const innerHash = url.hash.slice(1);
      if (innerHash) {
        hashPayload = decodeURIComponent(innerHash);
        await decryptFromHash();
      } else {
        throw new Error('Hidden URL has no encrypted payload.');
      }
    } else {
      throw new Error('Unexpected stego payload format.');
    }
  }

  async function decryptFromHash() {
    log('Decrypting payload...');
    const bytes = base64UrlDecode(hashPayload);
    const compressedB64 = await decrypt(bytes, password);
    const compressed = Uint8Array.from(atob(compressedB64), c => c.charCodeAt(0));

    let json: string;
    try {
      const decompressed = await gunzipBytes(compressed);
      json = new TextDecoder().decode(decompressed);
    } catch {
      json = compressedB64;
    }

    const data = JSON.parse(json) as any;

    if (data.v !== 1) {
      throw new Error('Unsupported payload version.');
    }

    if (data.mode === 'inline') {
      await handleInlinePayload(data);
    } else if (data.mode === 'ghost') {
      await handleGhostPayload(data);
    } else {
      throw new Error('Unknown payload mode.');
    }
  }

  async function handleInlinePayload(data: any) {
    if (data.kind === 'text') {
      log('Decrypted text message.');
      openedText = data.text || '';
    } else if (data.kind === 'file' && data.data) {
      log(`Decrypted file: ${data.name}`);
      const binary = atob(data.data);
      const buf = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
      const blob = new Blob([buf], { type: data.type || 'application/octet-stream' });
      openedFileUrl = URL.createObjectURL(blob);
      openedFileName = data.name || 'download';
    } else {
      throw new Error('Unsupported inline payload.');
    }
  }

  async function handleGhostPayload(data: any) {
    const urls: string[] = data.urls || (data.url ? [data.url] : []);
    const isStego: boolean = data.stego ?? false;

    if (urls.length === 0) throw new Error('No download URLs in payload.');

    let fileBytes: Uint8Array | null = null;
    let lastErr = '';

    for (const url of urls) {
      try {
        log(`Fetching from ${new URL(url).hostname}...`);
        const res = await fetch(`/api/ghost/fetch?url=${encodeURIComponent(url)}`);
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          continue;
        }
        fileBytes = new Uint8Array(await res.arrayBuffer());
        log('Downloaded encrypted file.');
        break;
      } catch (e: any) {
        lastErr = e?.message || 'Network error';
      }
    }

    if (!fileBytes) throw new Error(`All download sources failed: ${lastErr}`);

    let encrypted: Uint8Array;
    if (isStego) {
      log('Extracting from steganography...');
      const extracted = await extractStego(fileBytes);
      if (!extracted) throw new Error('Failed to extract stego data.');
      encrypted = extracted;
    } else {
      encrypted = fileBytes;
    }

    log('Decrypting file...');
    const { data: decryptedData, name } = await decryptData(encrypted, password);

    if (name.endsWith('.txt') && decryptedData.length < 100_000) {
      const text = new TextDecoder().decode(decryptedData);
      const isPrintable = !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 200));
      if (isPrintable) {
        openedText = text;
        log('Decrypted text content.');
        return;
      }
    }

    const blob = new Blob([decryptedData], { type: 'application/octet-stream' });
    openedFileUrl = URL.createObjectURL(blob);
    openedFileName = name;
    log(`Decrypted file: ${name}`);
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
      An encrypted payload was found. Enter the password to decrypt.
    </p>
  {:else}
    <div class="space-y-4">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">
        Open a <code class="text-emerald-500">/u#...</code> link to decrypt automatically, or upload a steganography image below.
      </p>
      <div class="space-y-2">
        <label class="label block" for="ud-stego">Upload stego image</label>
        <input id="ud-stego" type="file" accept="image/*" class="input cursor-pointer text-xs" on:change={handleStegoFile} />
      </div>
    </div>
  {/if}

  <div class="space-y-2">
    <label class="label block" for="ud-pass">Password</label>
    <input
      id="ud-pass"
      type="password"
      class="input"
      bind:value={password}
      autocomplete="current-password"
      placeholder="Enter the password"
    />
  </div>

  <button
    class="btn w-full"
    type="button"
    on:click={handleDecrypt}
    disabled={loading || (!hasHash && !stegoFile)}
  >
    {loading ? 'Decrypting...' : 'Decrypt'}
  </button>

  {#if logs.length > 0}
    <div class="space-y-1">
      {#each logs as entry}
        <p class="text-[11px] font-mono text-zinc-400">{entry}</p>
      {/each}
    </div>
  {/if}

  {#if error}
    <p class="text-xs text-red-500">{error}</p>
  {/if}

  {#if openedText}
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="label block">Decrypted message</label>
        <CopyButton text={openedText} label="COPY" />
      </div>
      <div class="result-box min-h-[80px] whitespace-pre-wrap">
        {openedText}
      </div>
    </div>
  {/if}

  {#if openedFileName && openedFileUrl}
    <div class="space-y-2">
      <p class="text-xs text-emerald-500">File decrypted: {openedFileName}</p>
      <button type="button" class="btn-outline text-xs" on:click={downloadFile}>
        Download {openedFileName}
      </button>
    </div>
  {/if}
</div>
