<script lang="ts">
  import { onMount } from 'svelte';
  import { kitAllowed, loadKit } from '../lib/asciiKit';
  import { BG_MODE_EVENT, readBgMode, type BgMode } from '../lib/bgMode';

  let host: HTMLDivElement;

  onMount(() => {
    if (!kitAllowed()) return;
    let handle: { setPreset(preset: unknown): void; destroy(): void } | null = null;
    let presets: Record<BgMode, unknown> | null = null;
    let gone = false;
    let rects: DOMRect[] = [];
    let dirty = true;
    const range = document.createRange();
    const mark = () => { dirty = true; };
    const read = () => {
      if (!dirty) return rects;
      dirty = false;
      rects = [...document.querySelectorAll('main h1, main .page-lead')].flatMap((el) => {
        range.selectNodeContents(el);
        return [...range.getClientRects()];
      });
      return rects;
    };
    addEventListener('scroll', mark, { passive: true, capture: true });
    addEventListener('resize', mark, { passive: true });
    document.fonts?.addEventListener('loadingdone', mark);

    loadKit().then((kit) => {
      if (gone) return;
      presets = { estuary: kit.estuary, capillary: kit.capillary, shockwave: kit.shockwave };
      handle = kit.background(host, {
        preset: presets[readBgMode()] as never,
        ink: '--text',
        cellSize: 12,
        charset: ' .:-=+YCIFSA#@',
        clear: read,
        clearPadding: 6,
        clearSoftness: 28,
      }) as unknown as typeof handle;
    }).catch(() => {});

    const change = (event: Event) => {
      const mode = (event as CustomEvent<BgMode>).detail;
      if (presets && handle && presets[mode]) handle.setPreset(presets[mode]);
    };
    window.addEventListener(BG_MODE_EVENT, change);
    return () => {
      gone = true;
      removeEventListener('scroll', mark, { capture: true });
      removeEventListener('resize', mark);
      document.fonts?.removeEventListener('loadingdone', mark);
      window.removeEventListener(BG_MODE_EVENT, change);
      handle?.destroy();
    };
  });
</script>

<div bind:this={host} class="ascii-bg"></div>
