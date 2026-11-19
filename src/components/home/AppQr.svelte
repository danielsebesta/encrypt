<script lang="ts">
  import { QR_COLORS } from '../../lib/qrColors';
  import { onMount } from 'svelte';

  export let path: string;
  export let alt: string;

  let svg = '';

  onMount(async () => {
    const { default: QRCode } = await import('qrcode');
    svg = await QRCode.toString(new URL(path, location.origin).href, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 120,
      color: QR_COLORS,
    });
  });
</script>

<div class="home-app__qr">
  <div class="home-app__qr-code" role="img" aria-label={alt}>{@html svg}</div>
</div>
