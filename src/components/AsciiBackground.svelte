<script lang="ts">
  import { onMount } from 'svelte';
  import { kitAllowed } from '../lib/asciiKit';

  const RAMPS = {
    dark: ['#1f4a2a', '#3f8a4c', '#6fb35a', '#86b85f'],
    light: ['#bcd9b4', '#7fb36f', '#4a8a3c', '#2e5921'],
  };

  let canvas: HTMLCanvasElement;

  onMount(() => {
    if (!kitAllowed()) return;
    let field: { update(options: Record<string, unknown>): void; destroy(): void } | null = null;
    let gone = false;
    const isDark = () => document.documentElement.classList.contains('dark');

    import('asciify-engine/field').then(({ mountGlyphField, isGlyphFieldSupported, defineFieldEffect }) => {
      if (gone || !isGlyphFieldSupported()) return;
      const pulses = defineFieldEffect({
        name: 'flow-pulses',
        animate: true,
        params: { depth: 0.75 },
        shade: `
          float a = fract(time * 0.045) * 1.6 - 0.3;
          float b = fract(time * 0.032 + 0.5) * 1.6 - 0.3;
          float h = fract(time * 0.028 + 0.2) * 1.5 - 0.25;
          float k = smoothstep(0.2, 0., abs(uv.x - a)) + smoothstep(0.16, 0., abs(uv.x - b)) + smoothstep(0.22, 0., abs(uv.y - h));
          tone *= 1. - clamp(k, 0., 1.) * params.depth;
        `,
      });
      field = mountGlyphField(canvas, {
        source: '/flow-ascii-src.webp',
        charset: ' .:-=+*#%@',
        cellSize: 8,
        cellAspect: 0.62,
        sample: 'shape',
        color: 'ink',
        ramp: RAMPS[isDark() ? 'dark' : 'light'],
        background: 'transparent',
        hover: 'none',
        shade: 0.2,
        drift: 0.06,
        effects: [pulses],
        label: '',
      }) as unknown as typeof field;
    }).catch(() => {});

    const theme = new MutationObserver(() => field?.update({ ramp: RAMPS[isDark() ? 'dark' : 'light'] }));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      gone = true;
      theme.disconnect();
      field?.destroy();
    };
  });
</script>

<canvas bind:this={canvas} class="ascii-bg" aria-hidden="true"></canvas>
