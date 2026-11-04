<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { t } from '../../lib/t';
  import { LUCIDE } from '../../lib/lucideIcons';

  export let dict: Record<string, string>;
  export let title = '';
  export let url = '';
  export let password = '';
  export let warning = '';
  export let onDismiss: (() => void) | null = null;
  export let appMode = false;

  let qrSvg = '';
  let qrFor = '';
  let showPassword = false;
  let canShare = false;
  let copiedLink = false;
  let copiedPass = false;
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

  onDestroy(() => {
    for (const timer of copyTimers) clearTimeout(timer);
    copyTimers = [];
  });

  function flash(which: 'link' | 'pass') {
    if (which === 'link') copiedLink = true;
    if (which === 'pass') copiedPass = true;
    const timer = setTimeout(() => {
      if (which === 'link') copiedLink = false;
      if (which === 'pass') copiedPass = false;
    }, 1500);
    copyTimers.push(timer);
  }

  async function copy(text: string, which: 'link' | 'pass') {
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

<div class="invite-card" class:card={!appMode} class:invite-card--app={appMode}>
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
        <button type="button" class={appMode ? 'app-icon-btn' : 'btn-ghost btn-sm btn-icon'} on:click={() => onDismiss?.()} aria-label={t(dict, 'chat.inviteCard.dismiss')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['x']}</svg>
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
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent" aria-hidden="true">{@html LUCIDE['check']}</svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['copy']}</svg>
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
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html showPassword ? LUCIDE['eye-off'] : LUCIDE['eye']}</svg>
      </button>
      <button type="button" class="invite-card__copy" on:click={() => copy(password, 'pass')} aria-label={t(dict, 'chat.inviteCard.copyPasswordSeparate')} title={copiedPass ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copyPasswordSeparate')}>
        {#if copiedPass}
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent" aria-hidden="true">{@html LUCIDE['check']}</svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['copy']}</svg>
        {/if}
      </button>
    </div>
  {/if}

  <div class="invite-card__share">
    {#if canShare}
      <button type="button" class={appMode ? 'app-sheet-btn w-full' : 'btn btn-sm w-full'} on:click={share} disabled={!url}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html LUCIDE['share-2']}</svg>
        <span>{t(dict, 'chat.inviteCard.share')}</span>
      </button>
    {/if}
    <div class="invite-card__share-row">
      <button type="button" class={appMode ? 'app-sheet-btn app-sheet-btn--tonal flex-1' : canShare ? 'btn-secondary btn-sm flex-1' : 'btn btn-sm flex-1'} on:click={() => copy(url, 'link')} disabled={!url}>
        {copiedLink ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copyLink')}
      </button>
      {#if password}
        <button type="button" class={appMode ? 'app-sheet-btn app-sheet-btn--tonal flex-1' : 'btn-secondary btn-sm flex-1'} on:click={() => copy(password, 'pass')}>
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
  .invite-card__copy {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    margin: -0.625rem -0.5rem -0.625rem 0;
    padding: 0;
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
