<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../lib/t';

  export let dict: Record<string, string>;
  export let locale = 'en';

  type Scene = 'text' | 'file' | 'draw';
  const SCENES: Scene[] = ['text', 'file', 'draw'];
  const LABELS: Record<Scene, string> = { text: 'landing.demo.write', file: 'landing.demo.file', draw: 'landing.demo.draw' };
  const SKETCHES = [
    'M71.8 39.7L71.5 74.2L81.8 74.7L108.1 74.9L108.3 70.7L108.8 69.4L109 65.2L110.5 56.3L111 46.8L111.9 40.2L105.7 40.2L82.6 38.4L73.8 38.4L72.5 39.1M58.5 76.2L58.5 70.9L59.6 67.6L60 63.6M66.2 74.9L66.3 63.6M35.3 67.4L41.7 67.8L42.3 68.3L70.7 68.5M83.7 77.6L83.7 79.3L85.5 83.1L89.1 86.6L92.2 87.9L101.6 90.4L119.6 92.4L128.7 97.7L131.1 98.6L134.2 99L140.2 102.3L144.4 103.9L149 105M164.7 97.7L158.6 93.7L146.2 89.1L137.1 88L135.7 87.1L128.2 86.2L127.3 85.5L123.8 84.6L121.1 84.4L118.3 82.7L110.9 82.2L108.8 81.5L101.7 80.6L98.3 78L98.3 76.9M70.2 40.2L70 39.9L70.7 39L73.5 36.6L79.8 28.9L85 24L86.2 21.1L93.3 10.5L101.4 23.3L103.2 27.5L105.9 31.1L107 33.7L112.3 40.2L113.8 44.1M83.7 74.7L83.7 70.7L85 64.5L85.3 59.4L85.9 59L86.2 56.1L95.9 57L96.3 58.3L96.3 74.7M103.4 27.7L103.7 18L104.3 16.7L109 16.7L109.6 19.6L109.8 34.6M106.7 10L108.1 8.9L107 7.4L108.8 5L108.1 4.9L108.3 3.4L109.8 2.1L109.8 0.7L109 0.1L109.2 -5M96.3 65.6L93.9 65.2L93.7 63.2M37.9 74.9L37.7 61.8M45.4 76.5L44.6 64.9M52.1 77.5L52.3 64.3',
    'M70 82 C48 82 46 52 62 42 L60 18 L80 32 C90 29 110 29 120 32 L140 18 L138 42 C154 52 152 82 130 82 Z M80 54 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M114 54 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M100 62 L95 68 H105 Z M94 72 Q100 77 106 72 M62 60 L32 54 M62 68 L32 72 M138 60 L168 54 M138 68 L168 72',
    'M99.1 18.9L98.3 17.9L95.5 17.9L92.6 18.9L88.3 21.5L87.3 23.2L86.7 25.5L86.7 33.8L90 39.1L93.6 41.4L97.5 42.5L99.2 42.5L100.4 43.3L107 43.3L110.2 40.4L110.8 38.7L111.4 38.4L112.7 33.6L112.5 27.4L109.1 23.6L105.7 20.9L104.4 20.7L103 19.8L99.6 19.4M87.1 36.5L77.7 42.1L73.1 47.3L71.2 50.9L71 57.1L72.4 57.7L73.7 59.2L77.3 60.1L81.1 60.1L82 59.2L84.1 58.6L85.8 57.7L86.2 56.9L87.9 56.5L91.3 53.5L93.8 48L96 45.2L96.4 43.5L97.3 48L98.3 57.1L101.1 63.9L104.5 67.7L108.3 67.9L110.4 66.8L110.4 65.8L111.4 64.9L112.1 62.6L112.1 52.7L110.4 48.4L108.9 47.1L107.6 44.2L108.5 44.4L108.9 45L111.4 45.4L111.7 45.9L117 47.3L127.5 48L128.2 48.6L138.6 48.6L140.1 47.4L140.1 42.1L139 39.9L135 35.7L129.7 33.1L124 32.1L115.3 32.1L116.3 31.2L123.5 28.9L126.3 26.4L127.8 26L132 22.5L134.5 19.4L135.8 16.8L136 12.4L134.1 10.3L130.5 9L128.6 7.7L125.9 6.7L120.1 6.5L117 8.8L114.6 9.4L112.5 11.3L110.6 15.4L110.4 17.3L108.9 19.4L106.6 3.9L102.8 -1.8L100.2 -4.8L90 -4.8L87.3 -3.3L85.4 -1.2L84.3 4.1L84.3 11.3L86.2 15.4L87.5 16L90.3 18.9L90.5 19.6L88.1 19.4L84.9 17.7L83.3 17.7L76.3 15.8L67.2 15.8L62.3 19.8L60.6 23.4L59.9 26.4L59.9 31.7L61.4 33.6L63.3 34.4L78.2 34.6L79.2 34.2L86 34.2M97.3 42.5L97.2 45.2L94.7 49L91.9 65.6L91.9 75.5L93.8 82.1L94.7 83L96.4 86.8L96.2 97.2L93 105',
    'M100 10 C120 28 122 52 116 68 H84 C78 52 80 28 100 10 Z M93 36 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M84 56 L66 76 L84 72 M116 56 L134 76 L116 72 M94 68 L100 90 L106 68 M40 22 V32 M35 27 H45 M160 38 V48 M155 43 H165 M150 84 V92 M146 88 H154',
    'M104.7 38.1L104.7 28.9L103.5 24.7L102.5 22L101.7 21.3L101.2 18.8L100.2 18.3L100 16.6L99.3 16.1L97.3 12.8L95.3 11.4L93.6 10.9L78.2 10.9L75.5 13.3L74.2 15.6L73.7 18.3L73.2 18.8L73.2 38.1L74.2 42.1L79.7 54L81.7 60.7L87.1 68.8L89.1 73.3L93.3 79.2L94.1 81.7L95 82.5L97 86.7L98.5 93.1L99.8 96.3L99.8 98.1L100.2 98.6M62.6 101L64.1 98.1L66.1 96.6L66.8 95.1L70.3 91.9L72.7 90.4M61.8 96.1L71.3 96.1L72.5 96.6M111.4 -5L112.1 -1.5L115.6 5.7L116.4 8.6M110.4 7.1L112.1 4.2L114.4 2.4L117.1 -0.8L118.3 -1.3L120.1 -3.5L120.6 -3.5M110.4 1.4L110.4 1.9L111.4 2.4L114.9 2.7L117.3 3.7L119.8 3.9L120.8 4.7M161.4 91.4L162.2 95.3L162.9 96.6L162.9 97.8L163.9 99.1L165.4 105M160.7 104.3L160.5 101.5L161.7 99.5L168.1 93.4M160.9 97.8L168.1 97.6L169.6 98.6M105.2 39.6L106.9 33.6L108.9 30.2L110.7 28.9L112.4 26.5L115.6 24.5L118.8 21.5L120.6 20.8L122.5 18.8L125 17.8L131.2 17.8L134.2 18.8L136.7 22.5L137.4 25.7L138.2 26.7L138.6 29.4L139.1 29.7L139.4 42.1L138.2 45.8L136.2 48.3L134.4 52.7L132.2 56.7L129 60.2L128.2 61.6L121.3 67.8L118.6 69.1L116.1 71.3L112.9 73.3L107.9 77.7L107.7 78.7L106.7 79.5L105.9 81.2L104 83.2L102.7 85.4L102.7 86.7L101.5 89.4L100.2 95.1L99.3 96.1M25.9 -1.3L25.9 1.4L26.7 2.2L27.2 4.4L30.4 11.1L31.4 15.8M25.4 10.9L24.9 10.9L24.9 7.6L25.4 6.4L27.2 4.9L29.4 0.9L32.6 -2.3M23.7 3.9L23.7 4.4L33.9 4.2M163.2 8.6L166.4 16.3L166.6 18.3L167.6 19.8L167.6 20.8L168.1 21L169.1 25.5M164.4 22L164.2 20.3L165.4 17.5L167.1 15.1L168.1 14.6L169.4 12.1L171.4 10.1M161.9 16.8L170.6 16.8L173.8 17.5L174.3 18.3L176.3 18.5M62.8 89.1L65.1 95.1L66.3 96.1L68 99.3L69.3 103.8',
  ];
  const SIZES = [3.8, 2.9, 5.1, 2.4, 4.2];
  const PHOTOS = ['lake', 'pasta', 'laptop', 'cat', 'castle'].map((slug, i) => ({
    src: `/demo/${slug}.webp`,
    name: t(dict, `landing.demo.photo.${i + 1}`),
    size: `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(SIZES[i])} MB`,
  }));
  const MESSAGES = [1, 2, 3, 4, 5].map((n) => t(dict, `landing.demo.sample.${n}`));
  const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const SHORT = 132;
  const TYPE_MS = 16;
  const SETTLE_MS = 500;
  const DRAW_MS = 1100;
  const HOLD_MS = 1600;

  let scene: Scene = 'text';
  const start = Math.floor(Math.random() * 5);
  const pick: Record<Scene, number> = { text: start, file: (start + 2) % 5, draw: (start + 4) % 5 };
  let plain = MESSAGES[pick.text];
  let photo = PHOTOS[pick.file];
  let sketch = SKETCHES[pick.draw];
  let typed = '';
  let cipher = '';
  let locked = false;
  let typing = false;
  let fileShown = false;
  let drawn = 0;

  function noise(length: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join('');
  }

  function toBase64(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/=+$/, '');
  }

  async function encrypt(data: Uint8Array): Promise<string> {
    try {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
      const out = new Uint8Array(iv.length + body.length);
      out.set(iv);
      out.set(body, iv.length);
      return toBase64(out);
    } catch {
      return noise(Math.ceil(((data.length + 28) * 4) / 3));
    }
  }

  async function photoBytes(): Promise<Uint8Array> {
    try {
      const response = await fetch(photo.src);
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      return crypto.getRandomValues(new Uint8Array(2048));
    }
  }

  async function sealed(which: Scene): Promise<string> {
    const encoder = new TextEncoder();
    const data = which === 'text' ? encoder.encode(plain) : which === 'file' ? await photoBytes() : encoder.encode(sketch.repeat(4));
    const full = await encrypt(data);
    return full.length > SHORT ? `${full.slice(0, SHORT)}…` : full;
  }

  let choose: (next: Scene) => void = () => {};
  let started = false;

  function select(next: Scene) {
    started = true;
    choose(next);
  }

  function loadExample(which: Scene) {
    const n = pick[which];
    if (which === 'text') plain = MESSAGES[n];
    else if (which === 'file') photo = PHOTOS[n];
    else sketch = SKETCHES[n];
  }

  function advanceExample(which: Scene) {
    pick[which] = (pick[which] + 1) % 5;
  }

  onMount(() => {
    let alive = true;
    let gen = 0;
    let timer: ReturnType<typeof setTimeout>;
    let raf = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const wait = (ms: number) => new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });

    function animate(ms: number, live: () => boolean, apply: (progress: number) => void): Promise<void> {
      return new Promise((resolve) => {
        const begin = performance.now();
        const step = (now: number) => {
          if (!live()) return resolve();
          const progress = Math.min(1, (now - begin) / ms);
          apply(progress);
          if (progress < 1) raf = requestAnimationFrame(step);
          else resolve();
        };
        raf = requestAnimationFrame(step);
      });
    }

    async function reveal(target: string, live: () => boolean) {
      await animate(SETTLE_MS, live, (progress) => {
        const settled = Math.floor(progress * target.length);
        const scramble = noise(target.length);
        cipher = Array.from(target, (ch, i) => (i < settled ? ch : scramble[i])).join('');
      });
      if (live()) cipher = target;
    }

    async function showStatic(which: Scene) {
      const g = ++gen;
      scene = which;
      loadExample(which);
      typed = plain;
      fileShown = true;
      drawn = 1;
      typing = false;
      const value = await sealed(which);
      if (g === gen) { cipher = value; locked = true; }
      advanceExample(which);
    }

    async function play(first: Scene, manual: boolean) {
      const g = ++gen;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      const live = () => alive && g === gen;
      let current = first;
      while (live()) {
        scene = current;
        loadExample(current);
        locked = false;
        cipher = '';
        typed = '';
        fileShown = false;
        drawn = 0;
        if (current === 'text') {
          typing = true;
          for (let i = 1; i <= plain.length && live(); i++) {
            typed = plain.slice(0, i);
            await wait(TYPE_MS);
          }
          typing = false;
        } else if (current === 'file') {
          await wait(150);
          fileShown = true;
          await wait(500);
        } else {
          await animate(DRAW_MS, live, (progress) => { drawn = progress; });
        }
        if (!live()) return;
        await wait(200);
        if (!live()) return;
        const target = await sealed(current);
        if (!target) return;
        locked = true;
        cipher = target;
        if (!live()) return;
        await reveal(target, live);
        if (!cipher) cipher = target;
        await wait(HOLD_MS);
        advanceExample(current);
        if (!manual) current = SCENES[(SCENES.indexOf(current) + 1) % SCENES.length];
      }
    }

    choose = (next) => {
      if (reduced) void showStatic(next);
      else void play(next, true);
    };

    if (reduced) {
      void showStatic('text');
    } else {
      timer = setTimeout(() => { if (!started) void play('text', false); }, 120);
    }

    return () => { alive = false; gen += 1; clearTimeout(timer); cancelAnimationFrame(raf); };
  });
</script>

<div class="demo" class:demo--locked={locked} role="img" aria-label={`${t(dict, LABELS[scene])}: ${plain}`}>
  <div class="demo__pane demo__pane--source">
    <p class="demo__label">{t(dict, LABELS[scene])}</p>
    {#if scene === 'text'}
      <p class="demo__plain">{typed}<span class="demo__caret" class:demo__caret--on={typing}></span></p>
    {:else if scene === 'file'}
      <div class="demo__file" class:demo__file--in={fileShown}>
        <img class="demo__file-thumb" src={photo.src} alt="" width="240" height="180" loading="lazy" decoding="async" />
        <span class="demo__file-meta">
          <span class="demo__file-name">{photo.name}</span>
          <span class="demo__file-size">{photo.size}</span>
        </span>
      </div>
    {:else}
      <svg class="demo__sketch" viewBox="0 -10 200 120" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d={sketch} pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - drawn} />
      </svg>
    {/if}
  </div>

  <div class="demo__link" aria-hidden="true">
    <span class="demo__logo">
      <img src="/encryptclick_icon.svg" alt="" width="28" height="42" />
    </span>
  </div>

  <div class="demo__pane demo__pane--cipher">
    <p class="demo__label">{t(dict, 'landing.demo.server')}<span class="demo__tag">AES-256-GCM</span></p>
    <p class="demo__cipher">{cipher || ' '}</p>
  </div>

  <div class="demo__dots" role="group" aria-label={t(dict, 'landing.demo.tabs')}>
    {#each SCENES as s}
      <button type="button" class="demo__dot" class:demo__dot--on={s === scene} aria-label={t(dict, LABELS[s])} aria-pressed={s === scene} on:click={() => select(s)}></button>
    {/each}
  </div>
</div>
