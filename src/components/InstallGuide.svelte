<script lang="ts">
  import { QR_COLORS } from '../lib/qrColors';
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import CopyButton from './CopyButton.svelte';
  import { t } from '../lib/t';

  export let dict: Record<string, string>;
  export let appHref = '/app';

  type Device = 'iosSafari' | 'iosOther' | 'androidChrome' | 'androidSamsung' | 'androidFirefox' | 'desktop';

  let device: Device | null = null;
  let installed = false;
  let canInstall = false;
  let installing = false;
  let pageUrl = '';
  let qrSvg = '';

  const steps: Record<Device, string[]> = {
    iosSafari: ['install.guide.iosSafari.1', 'install.guide.iosSafari.2', 'install.guide.iosSafari.3'],
    iosOther: ['install.guide.iosOther.1', 'install.guide.iosOther.2', 'install.guide.iosOther.3'],
    androidChrome: ['install.guide.androidChrome.1', 'install.guide.androidChrome.2', 'install.guide.openFromIcon'],
    androidSamsung: ['install.guide.androidSamsung.1', 'install.guide.androidSamsung.2', 'install.guide.openFromIcon'],
    androidFirefox: ['install.guide.androidFirefox.1', 'install.guide.androidFirefox.2', 'install.guide.openFromIcon'],
    desktop: ['install.guide.desktop.1', 'install.guide.desktop.2', 'install.guide.desktop.3'],
  };

  function detect(): Device {
    const ua = navigator.userAgent || '';
    const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPhone|iPad|iPod/.test(ua) || touchMac) {
      return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? 'iosOther' : 'iosSafari';
    }
    if (/Android/.test(ua)) {
      if (/SamsungBrowser/.test(ua)) return 'androidSamsung';
      if (/Firefox|Fennec/.test(ua)) return 'androidFirefox';
      return 'androidChrome';
    }
    return 'desktop';
  }

  function markInstallable() {
    canInstall = typeof (window as any).__pwaInstall === 'function';
  }

  async function install() {
    const run = (window as any).__pwaInstall as (() => Promise<string>) | undefined;
    if (!run || installing) return;
    installing = true;
    const outcome = await run();
    installing = false;
    canInstall = false;
    if (outcome === 'accepted') installed = true;
  }

  onMount(() => {
    installed = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
    device = detect();
    pageUrl = location.origin + location.pathname;
    markInstallable();
    window.addEventListener('pwa-installable', markInstallable);
    window.addEventListener('appinstalled', () => { installed = true; canInstall = false; });
    if (device === 'desktop') {
      import('qrcode')
        .then(({ default: QRCode }) => QRCode.toString(pageUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 168, color: QR_COLORS }))
        .then((svg) => { qrSvg = svg; })
        .catch(() => {});
    }
    return () => window.removeEventListener('pwa-installable', markInstallable);
  });
</script>

{#if device}
  <section class="install-now panel" class:install-now--done={installed} aria-labelledby="install-now-title">
    {#if installed}
      <div class="install-now__head">
        <span class="icon-tile icon-tile--accent"><Icon name="check" size={20} /></span>
        <div>
          <h2 id="install-now-title" class="section-title">{t(dict, 'install.guide.installedTitle')}</h2>
          <p class="hint">{t(dict, 'install.guide.installedText')}</p>
        </div>
      </div>
      <div class="actions">
        <a class="btn" href={appHref}>{t(dict, 'install.guide.openApp')}</a>
      </div>
    {:else}
      <div class="install-now__head">
        <span class="icon-tile icon-tile--accent"><Icon name={device === 'desktop' ? 'qr-code' : 'phone'} size={20} /></span>
        <div>
          <h2 id="install-now-title" class="section-title">{t(dict, 'install.guide.title')}</h2>
          <p class="hint">{t(dict, 'install.guide.detected').replace('{device}', t(dict, `install.guide.device.${device}`))}</p>
        </div>
      </div>

      {#if canInstall}
        <p class="install-now__ready">{t(dict, 'install.guide.ready')}</p>
        <div class="actions">
          <button type="button" class="btn" on:click={install} disabled={installing}>
            <Icon name="download" />
            {t(dict, 'install.guide.button')}
          </button>
        </div>
      {/if}

      <div class="install-now__body">
        <ol class="install-steps">
          {#each steps[device] as key}
            <li>{t(dict, key)}</li>
          {/each}
        </ol>
        {#if device === 'desktop' && qrSvg}
          <div class="install-now__qr" role="img" aria-label={t(dict, 'install.guide.qrAlt')}>{@html qrSvg}</div>
        {/if}
      </div>

      {#if device === 'iosOther'}
        <div class="actions">
          <CopyButton variant="primary" text={pageUrl} label={t(dict, 'common.copy')} copiedLabel={t(dict, 'common.copied')} errorLabel={t(dict, 'common.uploadChallenge.retry')} />
        </div>
      {/if}
    {/if}
  </section>
{/if}
