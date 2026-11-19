<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import { t } from '../lib/t';
  import { solvePow } from '../lib/pow';
  import type { PowChallenge } from '../server/pow';

  let { dict, onpass, oncancel }: {
    dict: Record<string, string>;
    onpass: (pass: string, expires: number) => void;
    oncancel: () => void;
  } = $props();

  let open = $state(true);
  let progress = $state(0);
  let failed = $state(false);
  let passed = false;
  const abort = new AbortController();

  function closed() {
    abort.abort();
    if (passed) return;
    passed = true;
    oncancel();
  }

  async function prove() {
    failed = false;
    progress = 0;
    try {
      const challenge = (await (await fetch('/upload/challenge', { cache: 'no-store' })).json()) as PowChallenge;
      const solution = await solvePow(challenge, (share) => { progress = share; }, abort.signal);
      if (!solution) return;
      const res = await fetch('/upload/pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ solution }) });
      const data = (await res.json()) as { pass?: unknown; expires?: unknown };
      if (!res.ok || typeof data.pass !== 'string' || !Number.isSafeInteger(data.expires)) throw new Error();
      passed = true;
      open = false;
      onpass(data.pass, data.expires as number);
    } catch {
      if (!abort.signal.aborted) failed = true;
    }
  }

  onMount(() => {
    void prove();
    return () => abort.abort();
  });
</script>

<Modal bind:open {dict} size="sm" title={t(dict, 'common.uploadChallenge.title')} description={t(dict, 'common.uploadChallenge.body')} onclose={closed}>
  {#if failed}
    <p class="status status--error" role="alert">{t(dict, 'common.uploadChallenge.failed')}</p>
  {:else}
    <progress class="progress" max="1" value={progress} aria-label={t(dict, 'common.uploadChallenge.title')}></progress>
  {/if}
  {#snippet actions()}
    {#if failed}
      <button type="button" class="btn" onclick={prove}>{t(dict, 'common.uploadChallenge.retry')}</button>
    {/if}
    <button type="button" class="btn-secondary" onclick={() => { open = false; }}>{t(dict, 'common.uploadChallenge.cancel')}</button>
  {/snippet}
</Modal>

