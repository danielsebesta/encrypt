<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../lib/t';
  import { solvePow } from '../lib/pow';

  let { dict, onpass, oncancel }: {
    dict: Record<string, string>;
    onpass: (pass: string, expires: number) => void;
    oncancel: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let progress = $state(0);
  let failed = $state(false);
  const abort = new AbortController();

  function cancel(event?: Event) {
    event?.preventDefault();
    abort.abort();
    dialog.close();
    oncancel();
  }

  async function prove() {
    failed = false;
    progress = 0;
    try {
      const challenge = await (await fetch('/upload/challenge', { cache: 'no-store' })).json();
      const solution = await solvePow(challenge, (share) => { progress = share; }, abort.signal);
      if (!solution) return;
      const res = await fetch('/upload/pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ solution }) });
      const data = await res.json();
      if (!res.ok || typeof data.pass !== 'string' || !Number.isSafeInteger(data.expires)) throw new Error();
      dialog.close();
      onpass(data.pass, data.expires);
    } catch {
      if (!abort.signal.aborted) failed = true;
    }
  }

  onMount(() => {
    dialog.showModal();
    void prove();
    return () => abort.abort();
  });
</script>

<dialog bind:this={dialog} class="upload-challenge card" aria-labelledby="upload-challenge-title" aria-describedby="upload-challenge-body" oncancel={cancel}>
  <div class="stack">
    <div>
      <h2 id="upload-challenge-title" class="section-title">{t(dict, 'common.uploadChallenge.title')}</h2>
      <p id="upload-challenge-body" class="hint mt-1">{t(dict, 'common.uploadChallenge.body')}</p>
    </div>
    <progress class="upload-challenge__progress" max="1" value={progress} aria-labelledby="upload-challenge-title"></progress>
    {#if failed}
      <p class="status status--error" role="alert">{t(dict, 'common.uploadChallenge.failed')}</p>
    {/if}
    <div class="actions">
      {#if failed}
        <button type="button" class="btn" onclick={prove}>{t(dict, 'common.uploadChallenge.retry')}</button>
      {/if}
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
  .upload-challenge__progress {
    width: 100%;
    height: 0.5rem;
    appearance: none;
    border: 0;
    border-radius: 999px;
    overflow: hidden;
    background: var(--line);
    accent-color: var(--accent);
  }
  .upload-challenge__progress::-webkit-progress-bar {
    background: var(--line);
  }
  .upload-challenge__progress::-webkit-progress-value {
    background: var(--accent);
  }
  .upload-challenge__progress::-moz-progress-bar {
    background: var(--accent);
  }
  @keyframes upload-challenge-in {
    from {
      opacity: 0;
      transform: translateY(0.5rem);
    }
  }
</style>
