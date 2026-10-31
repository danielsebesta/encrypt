<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { t } from '../lib/t';
  import { classifyQrText, openReceiveLink, readQr } from '../lib/qrScan';

  export let dict: Record<string, string>;

  type Status = 'idle' | 'starting' | 'scanning' | 'reading' | 'opening';

  const key = (name: string) => `tools.ultimateDecrypt.scan.${name}`;

  let status: Status = 'idle';
  let error = '';
  let notice = '';
  let otherLink = '';
  let video: HTMLVideoElement | undefined;
  let fileInput: HTMLInputElement;
  let openButton: HTMLButtonElement | undefined;
  let closeButton: HTMLButtonElement | undefined;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $: cameraOpen = status === 'starting' || status === 'scanning';

  function cameraFailure(name: string | undefined): string {
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'noCamera';
    return 'cameraError';
  }

  function release() {
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) video.srcObject = null;
  }

  async function close() {
    release();
    if (cameraOpen) {
      status = 'idle';
      await tick();
      openButton?.focus();
    }
  }

  function accept(text: string): boolean {
    const target = classifyQrText(text, location);
    if (target.kind === 'text') return false;
    release();
    if (target.kind === 'receive') {
      status = 'opening';
      openReceiveLink(target.href);
    } else {
      status = 'idle';
      otherLink = target.url;
    }
    return true;
  }

  async function openCamera() {
    error = '';
    notice = '';
    otherLink = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      error = 'unsupported';
      return;
    }
    status = 'starting';
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      status = 'idle';
      error = cameraFailure((e as DOMException | undefined)?.name);
      return;
    }
    if (status !== 'starting' || !video) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = media;
    video.srcObject = media;
    status = 'scanning';
    try {
      await video.play();
    } catch {}
    await tick();
    closeButton?.focus();
    timer = setTimeout(scanFrame, 250);
  }

  async function scanFrame() {
    if (status !== 'scanning' || !video) return;
    if (video.readyState >= 2) {
      try {
        const text = await readQr(video);
        if (text && status === 'scanning') {
          if (accept(text)) return;
          notice = 'noLink';
        }
      } catch {
        await close();
        error = 'failed';
        return;
      }
    }
    if (status === 'scanning') timer = setTimeout(scanFrame, 200);
  }

  async function scanImage(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await close();
    error = '';
    notice = '';
    otherLink = '';
    status = 'reading';
    let text: string | null = null;
    try {
      const bitmap = await createImageBitmap(file);
      try {
        text = await readQr(bitmap, 1600);
      } finally {
        bitmap.close();
      }
    } catch {
      status = 'idle';
      error = 'failed';
      return;
    }
    status = 'idle';
    if (!text) error = 'notFound';
    else if (!accept(text)) error = 'noLink';
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && cameraOpen) {
      e.preventDefault();
      void close();
    }
  }

  onDestroy(release);
</script>

<svelte:window on:keydown={onKeydown} on:pagehide={close} />

<div class="stack">
  {#if cameraOpen}
    <video
      bind:this={video}
      class="mx-auto aspect-square w-full max-w-xs rounded-lg border border-line-soft bg-surface object-cover"
      playsinline
      muted
      aria-label={t(dict, key('preview'))}
    ></video>
    <p class="hint text-center" role="status">{t(dict, key(status === 'starting' ? 'starting' : 'aim'))}</p>
    {#if notice}
      <p class="status status--warn">{t(dict, key(notice))}</p>
    {/if}
    <button bind:this={closeButton} type="button" class="btn-secondary w-full" on:click={close}>{t(dict, key('close'))}</button>
  {:else}
    <div class="actions">
      <button bind:this={openButton} type="button" class="btn-secondary" on:click={openCamera} disabled={status !== 'idle'}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="4" height="4"/><rect x="13" y="13" width="4" height="4"/><path d="M13 7h4v2"/><path d="M7 15v2h2"/></svg>
        {t(dict, key('open'))}
      </button>
      <button type="button" class="btn-ghost" on:click={() => fileInput.click()} disabled={status !== 'idle'}>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        {t(dict, key('image'))}
      </button>
    </div>
    {#if status === 'reading'}
      <p class="hint" role="status">{t(dict, key('reading'))}</p>
    {:else if status === 'opening'}
      <p class="status status--ok" role="status">{t(dict, key('opening'))}</p>
    {/if}
  {/if}
  <input bind:this={fileInput} type="file" accept="image/*" hidden on:change={scanImage} />
  {#if error}
    <p class="status status--error" role="alert">{t(dict, key(error))}</p>
  {/if}
  {#if otherLink}
    <div class="status status--warn">
      <div>
        <p>{t(dict, key('otherLink'))}</p>
        <a href={otherLink} rel="noopener noreferrer" class="break-all font-semibold underline underline-offset-2">{otherLink}</a>
      </div>
    </div>
  {/if}
</div>
