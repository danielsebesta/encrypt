<script lang="ts">
  import { onMount } from 'svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  const SALT_SIZE = 16;
  const IV_SIZE = 12;
  const PBKDF2_ITERATIONS = 100000;

  type Payload = {
    v: number;
    id: string;
    name: string;
    size: number;
    mime: string;
    secret: string;
  };

  let payload: Payload | null = null;
  let parseError = '';
  let password = '';
  let downloading = false;
  let error = '';

  function base64UrlDecodeToBytes(input: string): Uint8Array {
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(pw: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(pw),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as any,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      } as Pbkdf2Params,
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  async function decryptFileBytes(data: Uint8Array, pw: string): Promise<ArrayBuffer> {
    const salt = data.slice(0, SALT_SIZE);
    const iv = data.slice(SALT_SIZE, SALT_SIZE + IV_SIZE);
    const ciphertext = data.slice(SALT_SIZE + IV_SIZE);
    const key = await deriveKey(pw, salt);
    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
  }

  onMount(() => {
    if (typeof window === 'undefined') return;
    try {
      const hash = window.location.hash || '';
      if (!hash || hash.length <= 1) {
        parseError = t(dict, 'downloadPage.errorMissingPayload');
        return;
      }
      const encoded = decodeURIComponent(hash.slice(1));
      const bytes = base64UrlDecodeToBytes(encoded);
      const json = new TextDecoder().decode(bytes);
      const obj = JSON.parse(json) as Payload;
      if (!obj || !obj.id || !obj.name || !obj.secret) {
        parseError = t(dict, 'downloadPage.errorInvalidPayload');
        return;
      }
      payload = obj;
      password = obj.secret || '';
    } catch (e: any) {
      parseError = e?.message || t(dict, 'downloadPage.errorParseFailed');
    }
  });

  async function handleDownload() {
    if (!payload) return;
    if (!password) {
      error = t(dict, 'downloadPage.errorPasswordRequired');
      return;
    }
    error = '';
    downloading = true;
    try {
      const res = await fetch(`/api/tunnel/${encodeURIComponent(payload.id)}`);
      if (!res.ok) {
        throw new Error(t(dict, 'downloadPage.errorDownloadFailed').replace('{status}', String(res.status)));
      }
      const buf = await res.arrayBuffer();
      const plaintext = await decryptFileBytes(new Uint8Array(buf), password);
      const blob = new Blob([plaintext], { type: payload.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = payload.name || t(dict, 'downloadPage.defaultFilename');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      error = e?.message || t(dict, 'downloadPage.errorDecryptFailed');
    } finally {
      downloading = false;
    }
  }
</script>

<div class="space-y-6 animate-in fade-in duration-500">
  {#if parseError}
    <p class="text-sm text-red-500">{parseError}</p>
  {:else if !payload}
    <p class="text-sm text-zinc-500">{t(dict, 'downloadPage.waiting')}</p>
  {:else}
    <div class="card p-6 md:p-8 space-y-4">
      <div class="space-y-1 text-left">
        <h2 class="text-sm font-bold uppercase tracking-widest text-zinc-500">{t(dict, 'downloadPage.encryptedFile')}</h2>
        <p class="text-xs text-zinc-500">
          <span class="font-mono">{payload.name}</span>
          {#if payload.size}
            <span class="opacity-75"> — {(payload.size / (1024 * 1024)).toFixed(1)} MB</span>
          {/if}
        </p>
      </div>

      <div class="space-y-2">
        <label for="decrypt-password" class="label block">
          {t(dict, 'downloadPage.passwordLabel')}
        </label>
        <input
          id="decrypt-password"
          type="text"
          class="input"
          bind:value={password}
          autocomplete="current-password"
          spellcheck="false"
        />
        <p class="text-[11px] text-zinc-500">
          {t(dict, 'downloadPage.passwordNote')}
        </p>
      </div>

      <button
        type="button"
        class="btn w-full md:w-auto"
        on:click={handleDownload}
        disabled={downloading}
      >
        {#if downloading}
          {t(dict, 'downloadPage.downloading')}
        {:else}
          {t(dict, 'downloadPage.downloadButton')}
        {/if}
      </button>

      {#if error}
        <p class="text-xs text-red-500">{error}</p>
      {/if}
    </div>
  {/if}
</div>
