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
    const TEXT = 'main :is(h1, h2, h3, p, li, dt, dd, .hint)';
    const SOLID = '.card, .panel, .home-hero__form, .home-ledger, .home-tools__grid, .home-app, .btn, button, dialog, details, table, [role="dialog"]';
    const range = document.createRange();
    let rects: DOMRect[] = [];
    let dirty = true;
    let frame = 0;
    const mark = () => { dirty = true; };
    const read = () => {
      if (!dirty) return rects;
      dirty = false;
      const next: DOMRect[] = [];
      for (const el of document.querySelectorAll(TEXT)) {
        if (canvas.contains(el) || el.closest(SOLID)) continue;
        range.selectNodeContents(el);
        for (const r of range.getClientRects()) {
          if (r.width > 2 && r.height > 2 && r.bottom > -80 && r.top < innerHeight + 80) next.push(r);
        }
      }
      rects = next;
      return rects;
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; dirty = true; });
    };
    addEventListener('scroll', mark, { passive: true, capture: true });
    addEventListener('resize', schedule, { passive: true });
    document.fonts?.addEventListener('loadingdone', schedule);
    const layout = new ResizeObserver(schedule);
    layout.observe(document.body);
    const content = new MutationObserver(schedule);
    content.observe(document.body, { childList: true, subtree: true, characterData: true });
    const isDark = () => document.documentElement.classList.contains('dark');

    import('asciify-engine/field').then(({ mountGlyphField, isGlyphFieldSupported, defineFieldEffect }) => {
      if (gone || !isGlyphFieldSupported()) return;
      const breathe = defineFieldEffect({
        name: 'ascii-breathe',
        animate: true,
        params: { depth: 0.14, swap: 0.8 },
        shade: `
          float slow = noise(cell * 0.18 + vec2(time * 0.05, -time * 0.035));
          tone *= 1. + (slow - 0.5) * 2. * params.depth * motion;
          float edge = noise(cell * 0.9 + vec2(time * 0.07, time * 0.05));
          float dir = hash(cell) > 0.5 ? 1. : -1.;
          glyph += dir * step(params.swap, edge) * motion;
        `,
      });
      field = mountGlyphField(canvas, {
        source: '/flow-ascii-src.webp?v=3',
        charset: ' .,:-~=+*#',
        cellSize: 12,
        cellAspect: 0.62,
        sample: 'shape',
        color: 'ink',
        ramp: RAMPS[isDark() ? 'dark' : 'light'],
        background: 'transparent',
        shade: 0.2,
        focus: { x: 0.5, y: 0 },
        drift: 0.02,
        effects: [breathe],
        clear: { rects: read, padding: 10, softness: 56, strength: 0.82, bend: 0 },
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
      content.disconnect();
      layout.disconnect();
      cancelAnimationFrame(frame);
      removeEventListener('scroll', mark, { capture: true });
      removeEventListener('resize', schedule);
      document.fonts?.removeEventListener('loadingdone', schedule);
      field?.destroy();
    };
  });
</script>

<canvas bind:this={canvas} class="ascii-bg" aria-hidden="true"></canvas>
