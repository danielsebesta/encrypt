<script lang="ts">
  import { ulid } from 'ulid';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  const MAX_BYTES = 100 * 1024 * 1024;
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  const SEND_INSTANCES = [
    { url: 'https://send.codespace.cz', limit: '10 GB', days: 7 },
    { url: 'https://upload.nolog.cz', limit: '5 GB', days: 7 },
    { url: 'https://send.skylerszijjarto.com', limit: '250 GB', days: 7 },
    { url: 'https://send.cyberjake.xyz', limit: '10 GB', days: 30 },
    { url: 'https://send.vis.ee', limit: '2.5 GB', days: 3 },
    { url: 'https://send.mni.li', limit: '8 GB', days: 7 },
    { url: 'https://send.adminforge.de', limit: '8 GB', days: 7 },
    { url: 'https://send.monks.tools', limit: '5 GB', days: 7 },
    { url: 'https://send.artemislena.eu', limit: '2.5 GB', days: 7 },
    { url: 'https://fileupload.ggc-project.de', limit: '2.5 GB', days: 7 },
    { url: 'https://send.kokomo.cloud', limit: '2.5 GB', days: 7 },
    { url: 'https://drop.chapril.org', limit: '1 GB', days: 5 },
    { url: 'https://send.canine.tools', limit: '1 GB', days: 7 },
    { url: 'https://send.blablalinux.be', limit: '1 GB', days: 7 },
  ];

  let file: File | null = null;
  let anonymizedBlob: Blob | null = null;
  let anonymizedName = '';
  let processing = false;
  let uploading = false;
  let error = '';
  let uploadUrl = '';
  let uploadProvider = '';

  function getExtension(name: string): string {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i) : '';
  }

  function anonymizeFilename(original: string): string {
    const ext = getExtension(original).toLowerCase() || '.bin';
    return `${ulid()}${ext}`;
  }

  async function stripExifImage(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas failed'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Blob failed'));
          },
          'image/jpeg',
          0.92
        );
      };
      img.onerror = () => reject(new Error('Image load failed'));
    });
  }

  async function anonymize(f: File): Promise<{ blob: Blob; name: string }> {
    const name = anonymizeFilename(f.name);
    if (IMAGE_TYPES.includes(f.type)) {
      const blob = await stripExifImage(f);
      return { blob, name: name.replace(/\.[^.]+$/, '.jpg') };
    }
    const buf = await f.arrayBuffer();
    return { blob: new Blob([buf], { type: f.type || 'application/octet-stream' }), name };
  }

  async function uploadToTmpfiles(blob: Blob, name: string): Promise<string> {
    const fd = new FormData();
    fd.append('file', blob, name);
    const res = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: fd,
      mode: 'cors',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const url = data?.data?.url ?? data?.url ?? data?.link;
    if (!url) throw new Error('No URL in response');
    return url.startsWith('http') ? url : `https://tmpfiles.org${url.startsWith('/') ? '' : '/'}${url}`;
  }

  async function uploadTo0x0(blob: Blob, name: string): Promise<string> {
    const fd = new FormData();
    fd.append('file', blob, name);
    const res = await fetch('https://0x0.st', {
      method: 'POST',
      body: fd,
      mode: 'cors',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const url = text.trim();
    if (!url.startsWith('http')) throw new Error('Invalid response');
    return url;
  }

  async function tryUpload(blob: Blob, name: string): Promise<{ url: string; provider: string }> {
    try {
      const url = await uploadToTmpfiles(blob, name);
      return { url, provider: 'tmpfiles.org' };
    } catch {
      try {
        const url = await uploadTo0x0(blob, name);
        return { url, provider: '0x0.st' };
      } catch (e) {
        throw e;
      }
    }
  }

  async function handleFile(e: Event) {
    const target = e.target as HTMLInputElement;
    const f = target.files?.[0];
    if (!f) return;
    if (f.size > MAX_BYTES) {
      error = t(dict, 'tools.anonUpload.fileTooLarge');
      return;
    }
    file = f;
    error = '';
    uploadUrl = '';
    anonymizedBlob = null;
    anonymizedName = '';
    processing = true;
    try {
      const { blob, name } = await anonymize(f);
      anonymizedBlob = blob;
      anonymizedName = name;
    } catch (e) {
      error = t(dict, 'tools.anonUpload.failedToProcess');
    } finally {
      processing = false;
    }
  }

  async function handleUpload() {
    if (!anonymizedBlob || !anonymizedName) return;
    uploading = true;
    error = '';
    uploadUrl = '';
    try {
      const { url, provider } = await tryUpload(anonymizedBlob, anonymizedName);
      uploadUrl = url;
      uploadProvider = provider;
    } catch (e) {
      error = t(dict, 'tools.anonUpload.uploadFailed');
    } finally {
      uploading = false;
    }
  }

  function downloadAnonymized() {
    if (!anonymizedBlob || !anonymizedName) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(anonymizedBlob);
    a.download = anonymizedName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function openSend(instance: string) {
    if (!anonymizedBlob || !anonymizedName) return;
    downloadAnonymized();
    window.open(instance, '_blank', 'noopener,noreferrer');
  }
</script>

<div class="space-y-8 animate-in fade-in duration-500">
  <div class="border-4 border-dashed border-zinc-50 dark:border-zinc-900 p-12 text-center rounded-3xl relative group bg-zinc-50/10 hover:bg-emerald-50/5 hover:border-emerald-500/20 transition-all">
    <input type="file" on:change={handleFile} class="absolute inset-0 opacity-0 cursor-pointer z-10" />
    <div class="space-y-4">
      <div class="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      </div>
      <div>
        <p class="text-base font-bold text-zinc-800 dark:text-zinc-200">{t(dict, 'tools.anonUpload.dropFile')}</p>
        <p class="text-xs text-zinc-500 mt-1 uppercase tracking-widest">{t(dict, 'tools.anonUpload.anonSteps')}</p>
      </div>
    </div>
  </div>

  {#if error}
    <p class="text-xs text-red-500">{error}</p>
  {/if}

  {#if processing}
    <div class="text-center py-4">
      <span class="text-xs font-bold text-emerald-500 animate-pulse uppercase tracking-[0.2em]">{t(dict, 'tools.anonUpload.processing')}</span>
    </div>
  {/if}

  {#if anonymizedBlob && anonymizedName}
    <div class="space-y-6 animate-in slide-in-from-bottom-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="text-xs font-mono text-zinc-500 dark:text-zinc-400">
          {t(dict, 'tools.anonUpload.anonAs')} <span class="text-emerald-600 font-bold">{anonymizedName}</span>
        </div>
        <button type="button" class="btn-outline text-xs" on:click={downloadAnonymized}>
          {t(dict, 'tools.anonUpload.download')}
        </button>
      </div>

      <div class="space-y-2">
        <span class="block text-xs font-bold uppercase tracking-widest text-zinc-500">{t(dict, 'tools.anonUpload.uploadTo')}</span>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn text-xs"
            on:click={handleUpload}
            disabled={uploading}
          >
            {#if uploading}
              {t(dict, 'tools.anonUpload.uploading')}
            {:else}
              {t(dict, 'tools.anonUpload.uploadAnonymous')}
            {/if}
          </button>
        </div>
      </div>

      {#if uploadUrl}
        <div class="space-y-2">
          <p class="text-[10px] font-bold uppercase text-zinc-400">{t(dict, 'tools.anonUpload.uploadSuccess')} ({uploadProvider})</p>
          <div class="flex justify-between items-center gap-2">
            <input type="text" readonly value={uploadUrl} class="input text-xs font-mono flex-1" />
            <button type="button" class="btn-outline text-xs shrink-0" on:click={() => navigator.clipboard.writeText(uploadUrl)}>
              {t(dict, 'tools.anonUpload.copy')}
            </button>
          </div>
        </div>
      {/if}

      <div class="space-y-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <p class="text-[10px] font-bold uppercase text-zinc-400">{t(dict, 'tools.anonUpload.sendInstances')}</p>
        <p class="text-[11px] text-zinc-500">{t(dict, 'tools.anonUpload.sendManual')}</p>
        <div class="flex flex-wrap gap-2">
          {#each SEND_INSTANCES.slice(0, 6) as instance}
            <a
              href={instance.url}
              target="_blank"
              rel="noopener noreferrer"
              class="btn-outline text-[10px] py-1.5 px-2"
              on:click|preventDefault={() => openSend(instance.url)}
            >
              {new URL(instance.url).hostname}
            </a>
          {/each}
        </div>
        <details class="text-[11px]">
          <summary class="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">{t(dict, 'tools.anonUpload.moreInstances')}</summary>
          <div class="mt-2 flex flex-wrap gap-2">
            {#each SEND_INSTANCES.slice(6) as instance}
              <a
                href={instance.url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-emerald-600 hover:underline"
                on:click|preventDefault={() => openSend(instance.url)}
              >
                {new URL(instance.url).hostname}
              </a>
            {/each}
          </div>
        </details>
      </div>
    </div>
  {/if}
</div>
