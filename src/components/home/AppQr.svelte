<script lang="ts">
  import { onMount } from 'svelte';

  export let path: string;
  export let label: string;
  export let alt: string;

  let svg = '';

  onMount(async () => {
    const { default: QRCode } = await import('qrcode');
    svg = await QRCode.toString(new URL(path, location.origin).href, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 120,
      color: { dark: '#0a0a0a', light: '#ffffff' },
    });
  });
</script>

<div class="home-app__qr">
  <p class="home-app__qr-label">{label}</p>
  <div class="home-app__qr-code" role="img" aria-label={alt}>{@html svg}</div>
</div>
