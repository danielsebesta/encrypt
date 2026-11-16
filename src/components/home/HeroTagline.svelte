<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  export let lines: string[];
  export let id: string;

  const HOLD_MS = 4800;
  const FRAME_MS = 45;
  const OUT_FRAMES = 4;
  const IN_FRAMES = 5;
  const LETTER = /[\p{L}\p{N}]/u;

  let host: HTMLElement;
  let current = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;

  function build(text: string): HTMLElement[] {
    host.textContent = '';
    const cells: HTMLElement[] = [];
    text.split(' ').forEach((word, i) => {
      if (i) host.append(' ');
      const w = document.createElement('span');
      w.style.display = 'inline-block';
      w.style.whiteSpace = 'nowrap';
      for (const ch of word) {
        const c = document.createElement('span');
        c.textContent = ch;
        w.append(c);
        cells.push(c);
      }
      host.append(w);
    });
    return cells;
  }

  function lock(cells: HTMLElement[]) {
    const widths = cells.map((c) => c.getBoundingClientRect().width);
    cells.forEach((c, i) => {
      c.dataset.ch = c.textContent ?? '';
      c.style.display = 'inline-block';
      c.style.width = `${widths[i]}px`;
      c.style.textAlign = 'center';
      c.style.overflow = 'hidden';
      c.style.verticalAlign = 'top';
    });
  }

  function scramble(cells: HTMLElement[], pool: string[]) {
    for (const c of cells) {
      if (LETTER.test(c.dataset.ch ?? '')) c.textContent = pool[Math.floor(Math.random() * pool.length)];
    }
  }

  const wait = (ms: number) => new Promise<void>((r) => { timer = setTimeout(r, ms); });

  async function cycle() {
    while (alive) {
      await wait(HOLD_MS);
      if (!alive) return;
      if (document.hidden) continue;
      const next = (current + 1) % lines.length;
      const pool = Array.from(new Set(Array.from(lines[current] + lines[next]).filter((ch) => LETTER.test(ch))));
      let cells = build(lines[current]);
      lock(cells);
      for (let f = 0; f < OUT_FRAMES && alive; f++) { scramble(cells, pool); await wait(FRAME_MS); }
      cells = build(lines[next]);
      lock(cells);
      for (let f = 0; f < IN_FRAMES && alive; f++) { scramble(cells, pool); await wait(FRAME_MS); }
      if (!alive) return;
      host.textContent = lines[next];
      current = next;
    }
  }

  onMount(() => {
    if (lines.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cycle();
  });

  onDestroy(() => {
    alive = false;
    clearTimeout(timer);
  });
</script>

<h1 {id} class="page-title home-hero__title">
  <span class="sr-only">{lines[0]}</span>
  <span aria-hidden="true" bind:this={host}>{lines[0]}</span>
</h1>
