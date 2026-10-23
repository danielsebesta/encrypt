<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../lib/t';
  import { PASS_MESSAGE, UPLOAD_ORIGIN } from '../lib/uploadPass';

  let { dict, onpass, oncancel }: {
    dict: Record<string, string>;
    onpass: (pass: string, expires: number) => void;
    oncancel: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let content: HTMLDivElement;
  let frame: HTMLIFrameElement | undefined = $state();
  let src = $state('');
  let compact = $state(false);
  let failed = $state(false);

  function receive(event: MessageEvent) {
    if (event.origin !== UPLOAD_ORIGIN || !frame || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data?.type === PASS_MESSAGE && typeof data.pass === 'string' && Number.isSafeInteger(data.expires)) {
      dialog.close();
      onpass(data.pass, data.expires);
    } else if (data?.type === `${PASS_MESSAGE}-error`) {
      failed = true;
    }
  }

  function cancel(event?: Event) {
    event?.preventDefault();
    dialog.close();
    oncancel();
  }

  onMount(() => {
    dialog.showModal();
    compact = content.clientWidth < 300;
    const root = document.documentElement;
    const params = new URLSearchParams({
      lang: root.lang || 'en',
      theme: root.classList.contains('dark') ? 'dark' : 'light',
      size: compact ? 'compact' : 'normal',
    });
    src = `${UPLOAD_ORIGIN}/challenge?${params}`;
  });
</script>

<svelte:window onmessage={receive} />

<dialog bind:this={dialog} class="upload-challenge card" aria-labelledby="upload-challenge-title" aria-describedby="upload-challenge-body" oncancel={cancel}>
  <div class="stack" bind:this={content}>
    <div>
      <h2 id="upload-challenge-title" class="section-title">{t(dict, 'common.uploadChallenge.title')}</h2>
      <p id="upload-challenge-body" class="hint mt-1">{t(dict, 'common.uploadChallenge.body')}</p>
    </div>
    {#if src}
      <iframe bind:this={frame} {src} title={t(dict, 'common.uploadChallenge.frameTitle')} class="upload-challenge__frame" class:upload-challenge__frame--compact={compact} referrerpolicy="no-referrer"></iframe>
    {/if}
    {#if failed}
      <p class="status status--error" role="alert">{t(dict, 'common.uploadChallenge.failed')}</p>
    {/if}
    <div class="actions">
      <button type="button" class="btn-secondary" onclick={() => cancel()}>{t(dict, 'common.uploadChallenge.cancel')}</button>
    </div>
  </div>
</dialog>

<style>
  .upload-challenge {
    width: min(24rem, calc(100vw - 2rem));
    margin: auto;
    color: var(--text);
    box-shadow: var(--shadow-float);
    animation: upload-challenge-in var(--duration-dialog) var(--ease-out);
  }
  .upload-challenge::backdrop {
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(2px);
  }
  .upload-challenge__frame {
    display: block;
    width: 100%;
    height: 65px;
    border: 0;
  }
  .upload-challenge__frame--compact {
    height: 140px;
  }
  @keyframes upload-challenge-in {
    from {
      opacity: 0;
      transform: translateY(0.5rem);
    }
  }
</style>
