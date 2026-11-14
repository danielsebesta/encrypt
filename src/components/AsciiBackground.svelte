<script lang="ts">
  import { onMount } from 'svelte';
  import { kitAllowed } from '../lib/asciiKit';
  import { BG_MODE_EVENT, readBgMode, type BgMode } from '../lib/bgMode';

  const RAMPS = {
    dark: ['#1f4a2a', '#3f8a4c', '#6fb35a', '#86b85f'],
    light: ['#bcd9b4', '#7fb36f', '#4a8a3c', '#2e5921'],
  };
  const MODES: Record<BgMode, Record<string, unknown>> = {
    estuary: { hover: 'lantern', tap: 'surface' },
    capillary: { hover: 'trail', tap: 'surface' },
    shockwave: { hover: 'lantern', tap: 'ring' },
  };

  let canvas: HTMLCanvasElement;

  onMount(() => {
    if (!kitAllowed()) return;
    type Field = { update(options: Record<string, unknown>): void; pointer(x: number | null, y?: number): void; pulse(point?: { x: number; y: number }): void; destroy(): void };
    let field: Field | null = null;
    let mode: BgMode = readBgMode();
    let gone = false;
    const isDark = () => document.documentElement.classList.contains('dark');

    const move = (event: PointerEvent) => {
      if (!field) return;
      const box = canvas.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      if (y < 0 || y > box.height) field.pointer(null);
      else field.pointer(x, y);
    };
    const press = (event: PointerEvent) => {
      if (!field || mode !== 'shockwave') return;
      if ((event.target as HTMLElement | null)?.closest?.('button, a, input, textarea, select, label')) return;
      const box = canvas.getBoundingClientRect();
      if (event.clientY > box.bottom) return;
      field.pulse({ x: event.clientX - box.left, y: event.clientY - box.top });
    };
    const leave = () => field?.pointer(null);
    const change = (event: Event) => {
      mode = (event as CustomEvent<BgMode>).detail;
      field?.update(MODES[mode]);
    };

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
        charset: ' .:-=+YCIFSA#@',
        cellSize: 12,
        cellAspect: 0.62,
        sample: 'shape',
        color: 'ink',
        ramp: RAMPS[isDark() ? 'dark' : 'light'],
        background: 'transparent',
        shade: 0.2,
        drift: 0.06,
        effects: [pulses],
        label: '',
        ...MODES[mode],
      }) as unknown as Field;
    }).catch(() => {});

    const theme = new MutationObserver(() => field?.update({ ramp: RAMPS[isDark() ? 'dark' : 'light'] }));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    addEventListener('pointermove', move, { passive: true });
    addEventListener('pointerdown', press, { passive: true });
    document.addEventListener('pointerleave', leave);
    window.addEventListener(BG_MODE_EVENT, change);
    return () => {
      gone = true;
      theme.disconnect();
      removeEventListener('pointermove', move);
      removeEventListener('pointerdown', press);
      document.removeEventListener('pointerleave', leave);
      window.removeEventListener(BG_MODE_EVENT, change);
      field?.destroy();
    };
  });
</script>

<canvas bind:this={canvas} class="ascii-bg" aria-hidden="true"></canvas>
