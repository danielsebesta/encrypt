<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../lib/t';

  export let dict: Record<string, string>;
  export let title = '';
  export let url = '';
  export let password = '';
  export let safetyNumber = '';
  export let warning = '';
  export let onDismiss: (() => void) | null = null;

  let qrSvg = '';
  let qrFor = '';
  let showPassword = false;
  let canShare = false;
  let copiedLink = false;
  let copiedPass = false;
  let copiedSafety = false;
  let copyTimers: ReturnType<typeof setTimeout>[] = [];

  function sharePayload(): ShareData {
    const data: ShareData = { url };
    if (title) data.title = title;
    data.text = t(dict, password ? 'chat.inviteCard.shareTextPassword' : 'chat.inviteCard.shareText');
    return data;
  }

  onMount(() => {
    if (typeof navigator.share !== 'function') return;
    try {
      canShare = !navigator.canShare || navigator.canShare(sharePayload());
    } catch {
      canShare = false;
    }
  });

  async function renderQr(text: string) {
    qrFor = text;
    qrSvg = '';
    if (!text) return;
    try {
      const { default: QRCode } = await import('qrcode');
      for (const errorCorrectionLevel of ['M', 'L'] as const) {
        try {
          const svg = await QRCode.toString(text, {
            type: 'svg',
            errorCorrectionLevel,
            margin: 1,
            width: 220,
            color: { dark: '#105f3f', light: '#ffffff' },
          });
          if (qrFor === text) qrSvg = svg;
          return;
        } catch {
          /* too long for this level */
        }
      }
    } catch {
      qrSvg = '';
    }
  }

  $: if (url !== qrFor) void renderQr(url);

  function flash(which: 'link' | 'pass' | 'safety') {
    if (which === 'link') copiedLink = true;
    if (which === 'pass') copiedPass = true;
    if (which === 'safety') copiedSafety = true;
    const timer = setTimeout(() => {
      if (which === 'link') copiedLink = false;
      if (which === 'pass') copiedPass = false;
      if (which === 'safety') copiedSafety = false;
    }, 1500);
    copyTimers.push(timer);
  }

  async function copy(text: string, which: 'link' | 'pass' | 'safety') {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flash(which);
    } catch {}
  }

  async function share() {
    if (!url || !canShare || typeof navigator.share !== 'function') return;
    try {
      await navigator.share(sharePayload());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
</script>

<div class="invite-card card">
  <div class="invite-card__head">
    <div class="min-w-0 flex-1">
      {#if title}
        <h2 class="invite-card__title">{title}</h2>
      {/if}
      {#if warning}
        <p class="invite-card__warn">{warning}</p>
      {/if}
    </div>
    {#if onDismiss}
      <div class="invite-card__actions">
        <button type="button" class="btn-ghost btn-sm btn-icon" on:click={() => onDismiss?.()} aria-label={t(dict, 'chat.inviteCard.dismiss')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    {/if}
  </div>

  {#if qrSvg}
    <div class="ue-qr invite-card__qr" role="img" aria-label={t(dict, 'chat.inviteCard.qrAlt')}>{@html qrSvg}</div>
  {/if}

  <div class="invite-card__row">
    <span class="invite-card__label">{t(dict, 'chat.inviteCard.link')}</span>
    <code class="invite-card__value">{url}</code>
    <button type="button" class="invite-card__copy" on:click={() => copy(url, 'link')} aria-label={t(dict, 'chat.inviteCard.copyLink')} title={copiedLink ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copyLink')}>
      {#if copiedLink}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      {/if}
    </button>
  </div>

  {#if password}
    <div class="invite-card__row">
      <span class="invite-card__label">{t(dict, 'chat.inviteCard.password')}</span>
      <code class="invite-card__value">{showPassword ? password : '•'.repeat(Math.min(password.length, 16))}</code>
      <button
        type="button"
        class="invite-card__copy"
        on:click={() => { showPassword = !showPassword; }}
        aria-label={t(dict, showPassword ? 'common.hidePassword' : 'common.showPassword')}
        aria-pressed={showPassword}
        title={t(dict, showPassword ? 'common.hidePassword' : 'common.showPassword')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html showPassword ? '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/><path d="m2 2 20 20"/>' : '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>'}</svg>
      </button>
      <button type="button" class="invite-card__copy" on:click={() => copy(password, 'pass')} aria-label={t(dict, 'chat.inviteCard.copyPasswordSeparate')} title={copiedPass ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copyPasswordSeparate')}>
        {#if copiedPass}
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        {/if}
      </button>
    </div>
  {/if}

  {#if safetyNumber}
    <div class="invite-card__row">
      <span class="invite-card__label">{t(dict, 'chat.inviteCard.safetyNumber')}</span>
      <span class="invite-card__value invite-card__safety" aria-label={safetyNumber}>{#each safetyNumber.split(' ') as group}<span>{group}</span>{/each}</span>
      <button type="button" class="invite-card__copy" on:click={() => copy(safetyNumber, 'safety')} aria-label={t(dict, 'chat.inviteCard.copySafetyNumber')} title={copiedSafety ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copySafetyNumber')}>
        {#if copiedSafety}
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        {/if}
      </button>
    </div>
  {/if}

  <div class="invite-card__share">
    {#if canShare}
      <button type="button" class="btn btn-sm w-full" on:click={share} disabled={!url}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        <span>{t(dict, 'chat.inviteCard.share')}</span>
      </button>
    {/if}
    <div class="invite-card__share-row">
      <button type="button" class={canShare ? 'btn-secondary btn-sm flex-1' : 'btn btn-sm flex-1'} on:click={() => copy(url, 'link')} disabled={!url}>
        {copiedLink ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copyLink')}
      </button>
      {#if password}
        <button type="button" class="btn-secondary btn-sm flex-1" on:click={() => copy(password, 'pass')}>
          {copiedPass ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copyPasswordSeparate')}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .invite-card {
    padding: 0.75rem;
    text-align: left;
  }
  .invite-card__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .invite-card__title {
    font-size: 1rem;
    font-weight: 800;
    color: var(--text);
    word-break: break-word;
  }
  .invite-card__warn {
    margin-top: 0.25rem;
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--accent);
  }
  .invite-card__actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    flex-shrink: 0;
  }
  .invite-card__qr {
    margin-bottom: 0.75rem;
  }
  .invite-card__row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.375rem;
  }
  .invite-card__label {
    flex-shrink: 0;
    white-space: nowrap;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .invite-card__value {
    flex: 1;
    min-width: 0;
    font-size: 0.75rem;
    font-family: var(--font-mono);
    color: var(--muted);
    background: var(--surface-2);
    padding: 0.25rem 0.5rem;
    border-radius: 0.375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.dark) .invite-card__value {
    color: var(--text);
  }
  .invite-card__safety {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    font-family: inherit;
    font-size: 1.05rem;
    letter-spacing: 0.04em;
    color: var(--text);
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
  }
  .invite-card__copy {
    flex-shrink: 0;
    padding: 0.125rem;
    color: var(--muted);
    transition: color 0.15s;
  }
  .invite-card__copy:hover {
    color: var(--accent);
  }
  .invite-card__share {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .invite-card__share-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
