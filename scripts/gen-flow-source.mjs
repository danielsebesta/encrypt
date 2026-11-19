import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let seed = 5;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const LEVELS = [0.3, 0.45, 0.6, 0.75];
const WIDTHS = [1, 1.4];
const STEP = 6;
const MARGIN = 24;

function lines(W, H, band, count) {
  const ang = (x, y) => Math.PI / 2 + 0.9 * Math.sin(x * 0.006 + y * 0.004) + 0.5 * Math.sin(y * 0.011 - x * 0.003 + 1.7);
  const edge = (x) => Math.min(x, W - x);
  const out = [];
  for (let i = 0; i < count; i++) {
    const left = rnd() < 0.5;
    const x0 = left ? rnd() * band : W - rnd() * band;
    const y0 = rnd() * H;
    const pts = [[x0, y0]];
    for (const dir of [1, -1]) {
      let x = x0, y = y0;
      const seg = [];
      for (let s = 0; s < 70; s++) { const a = ang(x, y); x += Math.cos(a) * 9 * dir; y += Math.sin(a) * 9 * dir; seg.push([x, y]); }
      if (dir > 0) pts.push(...seg); else pts.unshift(...seg.reverse());
    }
    const fade = Math.max(0, Math.min(1, 1 - (edge(x0) - band * 0.12) / (band * 0.8)));
    if (fade < 0.08) continue;
    const opacity = fade * (0.45 + rnd() * 0.55);
    const width = 1.8 + rnd() * 1.6;
    out.push({ pts, opacity, width });
  }
  return out;
}

function runs(pts, W, H) {
  const inside = ([x, y]) => x > -MARGIN && x < W + MARGIN && y > -MARGIN && y < H + MARGIN;
  const result = [];
  let cur = [];
  pts.forEach((p, k) => {
    const keep = inside(p) || (k > 0 && inside(pts[k - 1])) || (k < pts.length - 1 && inside(pts[k + 1]));
    if (keep) cur.push(p);
    else if (cur.length) { result.push(cur); cur = []; }
  });
  if (cur.length) result.push(cur);
  return result.filter((r) => r.length > 2);
}

function spline(run) {
  const q = run.filter((_, k) => k % STEP === 0 || k === run.length - 1).map(([x, y]) => [Math.round(x), Math.round(y)]);
  const at = (k) => q[Math.max(0, Math.min(q.length - 1, k))];
  let d = `M${q[0][0]} ${q[0][1]}`;
  let [px, py] = q[0];
  for (let k = 1; k < q.length; k++) {
    const p0 = at(k - 2), p1 = at(k - 1), p2 = at(k), p3 = at(k + 1);
    const c2 = [Math.round(p2[0] - (p3[0] - p1[0]) / 6), Math.round(p2[1] - (p3[1] - p1[1]) / 6)];
    const rel = (p) => `${p[0] - px}${p[1] - py < 0 ? '' : ' '}${p[1] - py}`;
    if (k === 1) {
      const c1 = [Math.round(p1[0] + (p2[0] - p0[0]) / 6), Math.round(p1[1] + (p2[1] - p0[1]) / 6)];
      d += `c${rel(c1)} ${rel(c2)} ${rel(p2)}`;
    } else {
      d += `s${rel(c2)} ${rel(p2)}`;
    }
    [px, py] = p2;
  }
  return d.replace(/ -/g, '-');
}

function framing(id, W, H, band, count) {
  const groups = new Map();
  for (const { pts, opacity, width } of lines(W, H, band, count)) {
    const level = LEVELS.reduce((best, v, k) => (Math.abs(v - opacity) < Math.abs(LEVELS[best] - opacity) ? k : best), 0);
    const key = `${level}:${width > 2.6 ? 1 : 0}`;
    for (const run of runs(pts, W, H)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(spline(run));
    }
  }
  const body = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, paths]) => {
    const [level, width] = key.split(':').map(Number);
    return `<g stroke-opacity="${LEVELS[level]}" stroke-width="${WIDTHS[width]}">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  }).join('');
  return `<g id="${id}" fill="none" stroke-linecap="round">${body}</g>`;
}

const framings = [['wide', 1920, 1080, 520, 120], ['compact', 1920, 1080, 700, 150], ['portrait', 900, 1600, 300, 150]].map((f) => framing(...f)).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg"><style>path{vector-effect:non-scaling-stroke}</style><defs>${framings}</defs></svg>\n`;
writeFileSync(fileURLToPath(new URL('../public/flow-lines.svg', import.meta.url)), svg);
console.log(`flow-lines.svg written, ${svg.length} bytes`);
