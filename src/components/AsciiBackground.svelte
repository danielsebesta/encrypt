<script lang="ts">
  import { onMount } from 'svelte';
  import { kitAllowed } from '../lib/asciiKit';
  import { PALETTE } from '../lib/palette';

  const RAMPS = { dark: [...PALETTE.dark.ramp], light: [...PALETTE.light.ramp] };

  const SEEN = 'encrypt.click:ascii-bg-seen';

  let canvas: HTMLCanvasElement;

  onMount(() => {
    if (!kitAllowed()) return;
    type Field = { update(options: Record<string, unknown>): void; destroy(): void };
    let field: Field | null = null;
    let gone = false;
    const isDark = () => document.documentElement.classList.contains('dark');

    import('asciify-engine/field').then(({ mountGlyphField, isGlyphFieldSupported }) => {
      if (gone || !isGlyphFieldSupported()) return;
      field = mountGlyphField(canvas, {
        source: matchMedia('(orientation: portrait)').matches ? '/flow-ascii-src-portrait.webp?v=3' : '/flow-ascii-src.webp?v=3',
        charset: ' .:-=+YCIFSA#@',
        cellSize: 12,
        cellAspect: 0.62,
        sample: 'shape',
        color: 'ink',
        ramp: RAMPS[isDark() ? 'dark' : 'light'],
        background: 'transparent',
        shade: 0.2,
        drift: 0,
        label: '',
        hover: 'none',
        tap: 'none',
      }) as unknown as Field;
      (field as unknown as { ready?: Promise<void> }).ready?.then(() => {
        if (gone) return;
        const root = document.documentElement;
        try {
          if (sessionStorage.getItem(SEEN)) root.classList.add('ascii-instant');
          sessionStorage.setItem(SEEN, '1');
        } catch {}
        requestAnimationFrame(() => root.classList.add('ascii-ready'));
      }).catch(() => {});
    }).catch(() => {});

    const theme = new MutationObserver(() => {
      field?.update({ ramp: RAMPS[isDark() ? 'dark' : 'light'] });
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      gone = true;
      theme.disconnect();
      field?.destroy();
    };
  });
</script>

<canvas bind:this={canvas} class="ascii-bg" aria-hidden="true"></canvas>
