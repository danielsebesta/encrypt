<script lang="ts">
  import { QR_COLORS } from '../../lib/qrColors';
  import CopyButton from '../CopyButton.svelte';
  import Icon from '../Icon.svelte';

  export let id: string;
  export let url: string;
  export let label: string;
  export let copyLabel: string;
  export let copiedLabel: string;
  export let qrLabel: string;
  export let qrAlt: string;
  export let hint = '';

  let showQr = false;
  let qrSvg = '';
  let qrFor = '';

  async function render(text: string) {
    qrFor = text;
    qrSvg = '';
    const { default: QRCode } = await import('qrcode');
    for (const errorCorrectionLevel of ['H', 'L'] as const) {
      try {
        const svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel, margin: 1, width: 320, color: QR_COLORS });
        if (qrFor === text) qrSvg = svg;
        return;
      } catch {}
    }
  }

  $: if (url && url !== qrFor) void render(url);
</script>

<div class="field">
  <div class="output-head">
    <label class="label" for={id}>{label}</label>
    <div class="flex items-center gap-1">
      {#if qrSvg}
        <button type="button" class="btn-ghost btn-sm" aria-expanded={showQr} aria-controls="{id}-qr" on:click={() => (showQr = !showQr)}>
          <Icon name="qr-code" />
          {qrLabel}
        </button>
      {/if}
      <CopyButton text={url} label={copyLabel} {copiedLabel} />
    </div>
  </div>
  <input {id} class="input input--mono" type="text" readonly value={url} aria-describedby={hint ? `${id}-hint` : undefined} />
  {#if hint}
    <p id="{id}-hint" class="hint">{hint}</p>
  {/if}
  {#if showQr && qrSvg}
    <div id="{id}-qr" class="share-qr" role="img" aria-label={qrAlt}>{@html qrSvg}</div>
  {/if}
</div>
