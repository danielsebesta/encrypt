<script lang="ts">
  import { onMount } from 'svelte';
  import LZString from 'lz-string';
  import { encrypt, decrypt } from '../../lib/crypto';

  type Mode = 'create' | 'open';

  let mode: Mode = 'create';

  let textInput = '';
  let file: File | null = null;
  let password = '';
  let link = '';
  let createError = '';
  let loading = false;

  let hasHash = false;
  let hashPayload = '';
  let openPassword = '';
  let openError = '';
  let openLoading = false;
  let openedText = '';
  let openedFileName = '';

  const MAX_BYTES = 10 * 1024;

  onMount(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    if (hash.length > 1) {
      hasHash = true;
      mode = 'open';
      hashPayload = decodeURIComponent(hash.slice(1));
    }
  });

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    file = target.files && target.files[0] ? target.files[0] : null;
  }

  async function serializePayload() {
    if (file) {
      if (file.size > MAX_BYTES) {
        throw new Error('File too large for URL. Please keep under ~10KB.');
      }
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const b64 = btoa(String.fromCharCode(...bytes));
      return {
        kind: 'file',
        name: file.name,
        type: file.type || 'application/octet-stream',
        data: b64,
      };
    }

    const trimmed = textInput.trim();
    if (!trimmed) {
      throw new Error('Enter some text or select a file.');
    }
    if (new TextEncoder().encode(trimmed).byteLength > MAX_BYTES) {
      throw new Error('Text is too large for a URL. Please shorten it.');
    }
    return {
      kind: 'text',
      text: trimmed,
    };
  }

  function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlDecode(input: string): Uint8Array {
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function handleCreate() {
    createError = '';
    link = '';
    openedText = '';
    openedFileName = '';

    if (!password) {
      createError = 'Password is required.';
      return;
    }

    loading = true;
    try {
      const payload = await serializePayload();
      const json = JSON.stringify(payload);
      const compressed = LZString.compressToUTF16(json);

      const encrypted = await encrypt(compressed, password);
      const encoded = base64UrlEncode(encrypted);

      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://encrypt.click';
      link = `${origin}/drop#${encoded}`;
    } catch (e: any) {
      createError = e?.message || 'Failed to create link.';
    } finally {
      loading = false;
    }
  }

  async function handleOpen() {
    openError = '';
    openedText = '';
    openedFileName = '';

    if (!hashPayload) {
      openError = 'No data found in URL hash.';
      return;
    }
    if (!openPassword) {
      openError = 'Password is required.';
      return;
    }

    openLoading = true;
    try {
      const bytes = base64UrlDecode(hashPayload);
      const compressed = await decrypt(bytes, openPassword);
      const json = LZString.decompressFromUTF16(compressed);
      if (!json) {
        throw new Error('Could not decompress payload.');
      }
      const data = JSON.parse(json) as any;
      if (data.kind === 'text') {
        openedText = data.text || '';
      } else if (data.kind === 'file' && data.data) {
        const binary = atob(data.data);
        const buf = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
        const blob = new Blob([buf], { type: data.type || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.name || 'drop.bin';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        openedFileName = data.name || 'download';
      } else {
        throw new Error('Unsupported payload.');
      }
    } catch (e: any) {
      openError = e?.message || 'Failed to open drop.';
    } finally {
      openLoading = false;
    }
  }
</script>

<div class="space-y-8">
  {#if !hasHash}
    <div class="space-y-6">
      <div class="space-y-2">
        <label class="block text-xs font-bold uppercase tracking-widest text-zinc-500">
          Text (optional)
        </label>
        <textarea
          class="input min-h-[140px] resize-vertical font-mono text-xs"
          bind:value={textInput}
          placeholder="Write something to share as a one-shot, URL-only message..."
        />
      </div>

      <div class="space-y-2">
        <label class="block text-xs font-bold uppercase tracking-widest text-zinc-500">
          Or small file (≤ 10KB)
        </label>
        <input type="file" class="input cursor-pointer" on:change={handleFileChange} />
      </div>

      <div class="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-end">
        <div class="space-y-2">
          <label class="block text-xs font-bold uppercase tracking-widest text-zinc-500" for="dd-pass">
            Password
          </label>
          <input
            id="dd-pass"
            type="password"
            class="input"
            bind:value={password}
            autocomplete="new-password"
          />
        </div>
        <button class="btn w-full md:w-auto" type="button" on:click={handleCreate} disabled={loading}>
          {#if loading}
            Creating link...
          {:else}
            Generate link
          {/if}
        </button>
      </div>

      <p class="text-[11px] text-zinc-400">
        Payload is compressed, encrypted locally with AES‑GCM + PBKDF2, and stored entirely in the URL fragment.
        Nothing is sent to any server.
      </p>

      {#if createError}
        <p class="text-xs text-red-500">{createError}</p>
      {/if}

      {#if link}
        <div class="space-y-2">
          <label class="block text-xs font-bold uppercase tracking-widest text-zinc-500">
            Dead Drop Link
          </label>
          <input class="input text-xs font-mono" type="text" readonly value={link} />
        </div>
      {/if}
    </div>
  {:else}
    <div class="space-y-6">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">
        This link contains an encrypted payload. Enter the password to unlock it.
      </p>

      <div class="space-y-2">
        <label class="block text-xs font-bold uppercase tracking-widest text-zinc-500" for="dd-open-pass">
          Password
        </label>
        <input
          id="dd-open-pass"
          type="password"
          class="input"
          bind:value={openPassword}
          autocomplete="current-password"
        />
      </div>

      <button class="btn w-full md:w-auto" type="button" on:click={handleOpen} disabled={openLoading}>
        {#if openLoading}
          Decrypting...
        {:else}
          Open drop
        {/if}
      </button>

      {#if openError}
        <p class="text-xs text-red-500">{openError}</p>
      {/if}

      {#if openedText}
        <div class="space-y-2">
          <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-500">Decrypted text</h3>
          <div class="card p-4 text-left text-sm font-mono whitespace-pre-wrap break-words">
            {openedText}
          </div>
        </div>
      {/if}

      {#if openedFileName && !openedText}
        <p class="text-xs text-emerald-500">
          File downloaded: {openedFileName}
        </p>
      {/if}
    </div>
  {/if}
</div>

