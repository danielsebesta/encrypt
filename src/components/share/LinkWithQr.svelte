<script lang="ts">
  import CopyButton from '../CopyButton.svelte';

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

  // Same look as the share form's code; long links drop to the lowest error correction rather than to no code at all.
  async function render(text: string) {
    qrFor = text;
    qrSvg = '';
    const { default: QRCode } = await import('qrcode');
    for (const errorCorrectionLevel of ['H', 'L'] as const) {
      try {
        const svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel, margin: 1, width: 320, color: { dark: '#105f3f', light: '#ffffff' } });
        if (qrFor === text) qrSvg = svg;
        return;
      } catch {
        /* too long for this level */
      }
    }
  }

  $: if (url && url !== qrFor) void render(url);
</script>

<div class="field">
  <div class="output-head">
    <label class="label" for={id}>{label}</label>
    <div class="flex items-center gap-1">
      {#if qrSvg}
        <button type="button" class="btn-ghost btn-sm" aria-pressed={showQr} on:click={() => (showQr = !showQr)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><path d="M14 14h2"/><path d="M18 14h2v2"/><path d="M14 18h2v2h-2z"/><path d="M18 18h2v2h-2z"/></svg>
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
    <div id="{id}-qr" class="ue-qr" role="img" aria-label={qrAlt}>{@html qrSvg}</div>
  {/if}
</div>
