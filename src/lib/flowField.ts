export interface FlowLine {
  d: string;
  opacity: number;
  width: number;
}

export interface FlowOptions {
  /** Lines started per side for every TILE pixels of height. */
  perTile?: number;
  /** Minimum distance between two lines, in px. */
  gap?: number;
  /** `classic` keeps the original current and only varies its phases; `seeded` lets the seed reshape it. */
  shape?: 'classic' | 'seeded';
}

const TILE = 900;
const STEP = 8;
const STEPS = 90;

export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Streamlines of one smooth, mostly downward flow field, kept to the left and right edges.
 * The seed sets the current's tilt, the angle and scale of its waves, how far it swings, the line
 * density and weight, and the start points, so every page draws its own variation of the same idea.
 * Lines are traced tile by tile from the top, so a taller page only adds lines below the old ones.
 */
export function flowLines(seed: number, width: number, height: number, options: FlowOptions = {}): FlowLine[] {
  const rnd = random(seed);
  const span = (a: number, b: number) => a + rnd() * (b - a);
  const classic = options.shape === 'classic';
  let angle: (x: number, y: number) => number;
  if (classic) {
    const p1 = span(-0.6, 0.6);
    const p2 = span(1.1, 2.3);
    const f = span(0.9, 1.1);
    angle = (x, y) => Math.PI / 2 + 0.9 * Math.sin((x * 0.0055 + y * 0.0036) * f + p1) + 0.5 * Math.sin((y * 0.01 - x * 0.003) * f + p2);
  } else {
    const tilt = span(-0.32, 0.32);
    const turn = span(-0.7, 0.7);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const a1 = span(0.65, 1.15);
    const a2 = span(0.3, 0.7);
    const f1 = span(0.0042, 0.0068);
    const f2 = span(0.0075, 0.0125);
    const p1 = span(0, Math.PI * 2);
    const p2 = span(0, Math.PI * 2);
    angle = (x, y) => {
      const u = x * cos + y * sin;
      const v = y * cos - x * sin;
      return Math.PI / 2 + tilt + a1 * Math.sin((u * 0.84 + v * 0.55) * f1 + p1) + a2 * Math.sin((v - u * 0.3) * f2 + p2);
    };
  }
  const perTile = options.perTile ?? Math.round(span(24, 32));
  const gap = options.gap ?? span(15, 19);
  const weight = span(1.7, 2.1);

  const band = classic ? Math.min(width * 0.28, 560) : Math.min(width * span(0.28, 0.36), span(560, 700));
  const cell = gap;
  const cols = Math.ceil(width / cell) + 2;
  const rows = Math.ceil(height / cell) + 2;
  const owner = new Int32Array(cols * rows).fill(-1);
  const cellOf = (x: number, y: number) => {
    const cx = Math.floor(x / cell) + 1;
    const cy = Math.floor(y / cell) + 1;
    return cx < 0 || cy < 0 || cx >= cols || cy >= rows ? -1 : cy * cols + cx;
  };

  const out: FlowLine[] = [];
  const tiles = Math.ceil(height / TILE);
  let id = 0;
  for (let tile = 0; tile < tiles; tile++) {
    const r = random(hashSeed(`${seed}:${tile}`));
    for (let i = 0; i < perTile * 2; i++, id++) {
      const left = i % 2 === 0;
      const x0 = left ? r() * band : width - r() * band;
      const y0 = tile * TILE + r() * TILE;
      const shade = r();
      const thick = r();
      if (y0 > height) continue;
      const start = cellOf(x0, y0);
      if (start < 0 || [0, -1, 1, -cols, cols].some((o) => owner[start + o] >= 0)) continue;

      const halves: [number, number][][] = [];
      for (const dir of [1, -1]) {
        const pts: [number, number][] = [];
        let x = x0;
        let y = y0;
        const mine: number[] = [];
        for (let s = 0; s < STEPS; s++) {
          const a = angle(x, y);
          x += Math.cos(a) * STEP * dir;
          y += Math.sin(a) * STEP * dir;
          if (x < -40 || x > width + 40 || y < -40 || y > height + 40) break;
          const c = cellOf(x, y);
          if (c >= 0 && owner[c] === -1) mine.push(c);
          pts.push([x, y]);
        }
        for (const c of mine) owner[c] = id;
        halves.push(pts);
      }
      const pts = [...halves[1].reverse(), [x0, y0] as [number, number], ...halves[0]];
      if (pts.length < 40) continue;

      const edge = Math.min(x0, width - x0);
      const fade = Math.max(0, Math.min(1, 1.15 - edge / band));
      if (fade < 0.1) continue;
      out.push({ d: spline(pts), opacity: +(fade * (0.35 + shade * 0.65)).toFixed(2), width: +(weight + thick * 1.5).toFixed(1) });
    }
  }
  return out;
}

function spline(pts: [number, number][]): string {
  const q = pts.filter((_, k) => k % 3 === 0 || k === pts.length - 1).map(([x, y]) => [Math.round(x), Math.round(y)]);
  const at = (k: number) => q[Math.max(0, Math.min(q.length - 1, k))];
  let d = `M${q[0][0]} ${q[0][1]}`;
  for (let k = 1; k < q.length; k++) {
    const p0 = at(k - 2), p1 = at(k - 1), p2 = at(k), p3 = at(k + 1);
    const c1 = [Math.round(p1[0] + (p2[0] - p0[0]) / 6), Math.round(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [Math.round(p2[0] - (p3[0] - p1[0]) / 6), Math.round(p2[1] - (p3[1] - p1[1]) / 6)];
    d += `C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`;
  }
  return d;
}
