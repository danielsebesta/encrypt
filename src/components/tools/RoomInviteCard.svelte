<script lang="ts">
  import { QR_COLORS } from '../../lib/qrColors';
  import { onMount, onDestroy } from 'svelte';
  import { t } from '../../lib/t';
  import Icon from '../Icon.svelte';

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
  let qrOpen = false;
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
            color: QR_COLORS,
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

<div class="invite-card" class:panel={!appMode} class:invite-card--app={appMode}>
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
        <button type="button" class={appMode ? 'app-icon-btn' : 'btn-ghost btn-sm btn-icon'} on:click={() => onDismiss?.()} aria-label={t(dict, 'chat.inviteCard.dismiss')} title={t(dict, 'chat.inviteCard.dismiss')}>
          <Icon name="x" />
        </button>
      </div>
    {/if}
  </div>

  {#if qrSvg}
    {#if !appMode}
      <button type="button" class="btn-secondary btn-sm invite-card__qr-toggle" aria-expanded={qrOpen} aria-controls="invite-card-qr" on:click={() => { qrOpen = !qrOpen; }}>
        <Icon name="qr-code" />
        <span class="truncate">{t(dict, qrOpen ? 'chat.inviteCard.hideQr' : 'chat.inviteCard.showQr')}</span>
      </button>
    {/if}
    <div id="invite-card-qr" class="ue-qr invite-card__qr" class:invite-card__qr--folded={!appMode && !qrOpen} role="img" aria-label={t(dict, 'chat.inviteCard.qrAlt')}>{@html qrSvg}</div>
  {/if}

  <div class="invite-card__row">
    <span class="invite-card__label">{t(dict, 'chat.inviteCard.link')}</span>
    <code class="invite-card__value">{url}</code>
    <button type="button" class={appMode ? 'invite-card__copy' : 'btn-ghost btn-sm btn-icon'} on:click={() => copy(url, 'link')} aria-label={t(dict, 'chat.inviteCard.copyLink')} title={copiedLink ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copyLink')}>
      {#if copiedLink}
        <Icon name="check" class="text-accent" />
      {:else}
        <Icon name="copy" />
      {/if}
    </button>
  </div>

  {#if password}
    <div class="invite-card__row">
      <span class="invite-card__label">{t(dict, 'chat.inviteCard.password')}</span>
      <code class="invite-card__value">{showPassword ? password : '•'.repeat(Math.min(password.length, 16))}</code>
      <button
        type="button"
        class={appMode ? 'invite-card__copy' : 'btn-ghost btn-sm btn-icon'}
        on:click={() => { showPassword = !showPassword; }}
        aria-label={t(dict, showPassword ? 'common.hidePassword' : 'common.showPassword')}
        aria-pressed={showPassword}
        title={t(dict, showPassword ? 'common.hidePassword' : 'common.showPassword')}
      >
        <Icon name={showPassword ? 'eye-off' : 'eye'} />
      </button>
      <button type="button" class={appMode ? 'invite-card__copy' : 'btn-ghost btn-sm btn-icon'} on:click={() => copy(password, 'pass')} aria-label={t(dict, 'chat.inviteCard.copyPasswordSeparate')} title={copiedPass ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copyPasswordSeparate')}>
        {#if copiedPass}
          <Icon name="check" class="text-accent" />
        {:else}
          <Icon name="copy" />
        {/if}
      </button>
    </div>
  {/if}

  <span class="sr-only" role="status">{copiedLink || copiedPass ? t(dict, 'common.copied') : ''}</span>

  <div class="invite-card__share">
    {#if canShare}
      <button type="button" class={appMode ? 'app-sheet-btn w-full' : 'btn btn-sm btn-block'} on:click={share} disabled={!url}>
        <Icon name="share-2" />
        <span class="invite-card__share-label">{t(dict, 'chat.inviteCard.share')}</span>
      </button>
    {/if}
    <div class="invite-card__share-row">
      <button type="button" class={appMode ? 'app-sheet-btn app-sheet-btn--tonal flex-1' : canShare ? 'btn-secondary btn-sm invite-card__share-btn' : 'btn btn-sm invite-card__share-btn'} on:click={() => copy(url, 'link')} disabled={!url} title={t(dict, 'chat.inviteCard.copyLink')}>
        <span class="invite-card__share-label">{copiedLink ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copyLink')}</span>
      </button>
      {#if password}
        <button type="button" class={appMode ? 'app-sheet-btn app-sheet-btn--tonal flex-1' : 'btn-secondary btn-sm invite-card__share-btn'} on:click={() => copy(password, 'pass')} title={t(dict, 'chat.inviteCard.copyPasswordSeparate')}>
          <span class="invite-card__share-label">{copiedPass ? t(dict, 'common.copied') : t(dict, 'chat.inviteCard.copyPasswordSeparate')}</span>
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
    font-weight: 600;
    color: var(--text);
    word-break: break-word;
  }
  .invite-card__warn {
    margin-top: 0.25rem;
    font-size: 0.875rem;
    font-weight: 500;
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
  .invite-card.panel .invite-card__row {
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }
  .invite-card.panel .invite-card__label {
    min-width: 4.5rem;
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
    border-radius: 6px;
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
    transition: color var(--duration-fast) var(--ease-out);
  }
  .invite-card__copy:hover {
    color: var(--accent);
  }
  .invite-card__share {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.5rem;
    min-width: 0;
    margin-top: 0.75rem;
  }
  .invite-card__share-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .invite-card__share-btn {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .invite-card.panel .invite-card__share-label {
    min-width: 0;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }
  .invite-card__qr-toggle {
    display: none;
    margin-bottom: 0.5rem;
    max-width: 100%;
  }
  @media (min-width: 640px) and (min-height: 480px) {
    .invite-card.panel {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      column-gap: 1.25rem;
      align-content: start;
    }
    .invite-card.panel > * {
      grid-column: 1;
    }
    .invite-card.panel > .invite-card__head {
      grid-column: 1 / -1;
    }
    .invite-card.panel > .invite-card__qr {
      grid-column: 2;
      grid-row: 2 / span 4;
      margin: 0;
    }
  }
  @media (max-width: 399px), (max-height: 479px) {
    .invite-card.panel {
      display: flex;
      flex-direction: column;
    }
    .invite-card.panel .invite-card__qr-toggle {
      display: inline-flex;
      order: 1;
      align-self: flex-start;
      margin: 0.25rem 0 0;
    }
    .invite-card.panel .invite-card__qr {
      order: 1;
      margin: 0.5rem 0 0;
    }
    .invite-card.panel .invite-card__qr--folded {
      display: none;
    }
    .invite-card.panel .invite-card__share {
      order: 2;
    }
  }
</style>
