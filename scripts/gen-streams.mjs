import { writeFileSync } from 'node:fs';

const W = 1920;
const H = 1080;
const VARIANT = process.argv[2] === 'lanes' ? 'lanes' : 'flow';
const INK = '#000';
let seed = 5;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function lanes(pts, { n, gap, r, w }) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const d = (k - (n - 1) / 2) * gap;
    const off = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const s1 = i > 0 ? [p[0] - a[0], p[1] - a[1]] : [b[0] - p[0], b[1] - p[1]];
      const s2 = i < pts.length - 1 ? [b[0] - p[0], b[1] - p[1]] : s1;
      const nrm = (s) => { const l = Math.hypot(s[0], s[1]); return [-s[1] / l, s[0] / l]; };
      const n1 = nrm(s1), n2 = nrm(s2);
      const m = [n1[0] + n2[0], n1[1] + n2[1]];
      const ml = Math.hypot(m[0], m[1]);
      const dot = n1[0] * n2[0] + n1[1] * n2[1];
      const k2 = d / Math.max(0.3, (1 + dot) / 2);
      const q = Math.sqrt((1 + dot) / 2);
      return [p[0] + (m[0] / ml) * k2 * q, p[1] + (m[1] / ml) * k2 * q];
    });
    let path = `M${off[0][0].toFixed(1)} ${off[0][1].toFixed(1)}`;
    for (let i = 1; i < off.length - 1; i++) {
      const p = off[i], a = off[i - 1], b = off[i + 1];
      const la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
      const rad = Math.max(6, r + (cross * d > 0 ? -Math.abs(d) : Math.abs(d)));
      const t = Math.min(rad, la / 2, lb / 2);
      const p1 = [p[0] - ((p[0] - a[0]) / la) * t, p[1] - ((p[1] - a[1]) / la) * t];
      const p2 = [p[0] + ((b[0] - p[0]) / lb) * t, p[1] + ((b[1] - p[1]) / lb) * t];
      path += `L${p1[0].toFixed(1)} ${p1[1].toFixed(1)}Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    const e = off[off.length - 1];
    path += `L${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
    const alpha = 0.55 + rnd() * 0.45;
    out.push(`<path d="${path}" stroke="${INK}" stroke-width="${w}" opacity="${alpha.toFixed(2)}"/>` + (k % 2 ? `<circle cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="${w * 1.6}" fill="${INK}" stroke="none" opacity="${alpha.toFixed(2)}"/>` : ''));
  }
  return out.join('');
}

function laneArt() {
  const side = (list) => list.join('');
  const o = { n: 6, gap: 16, r: 70, w: 5 };
  return {
    left: [
      lanes([[150, -50], [150, 260], [330, 260], [330, 560], [90, 560], [90, 800], [260, 800], [260, 1130]], o),
      lanes([[-50, 120], [200, 120]], { ...o, n: 4, r: 40 }),
      lanes([[-50, 940], [420, 940], [420, 760]], { ...o, n: 4, r: 60 }),
    ].join(''),
    right: [
      lanes([[1770, -50], [1770, 200], [1590, 200], [1590, 520], [1830, 520], [1830, 820], [1650, 820], [1650, 1130]], o),
      lanes([[1970, 960], [1500, 960], [1500, 780]], { ...o, n: 4, r: 60 }),
      lanes([[1970, 80], [1500, 80], [1500, 300]], { ...o, n: 3, r: 60 }),
    ].join(''),
  };
}

function flowArt() {
  const ang = (x, y) => Math.PI / 2 + 0.9 * Math.sin(x * 0.006 + y * 0.004) + 0.5 * Math.sin(y * 0.011 - x * 0.003 + 1.7);
  const edge = (x) => Math.min(x, W - x);
  const out = { left: '', right: '' };
  for (let i = 0; i < 260; i++) {
    const left = rnd() < 0.5;
    const x0 = left ? rnd() * 400 : W - rnd() * 400, y0 = rnd() * H;
    const pts = [[x0, y0]];
    for (const dir of [1, -1]) {
      let x = x0, y = y0;
      const seg = [];
      for (let s = 0; s < 70; s++) { const a = ang(x, y); x += Math.cos(a) * 9 * dir; y += Math.sin(a) * 9 * dir; seg.push([x, y]); }
      if (dir > 0) pts.push(...seg); else pts.unshift(...seg.reverse());
    }
    const fade = Math.max(0, Math.min(1, 1 - (edge(x0) - 50) / 330));
    if (fade < 0.08) continue;
    const q = pts.filter((_, k) => k % 2 === 0);
    let d = `M${q[0][0].toFixed(0)} ${q[0][1].toFixed(0)}`;
    for (let k = 1; k < q.length - 1; k++) d += `Q${q[k][0].toFixed(0)} ${q[k][1].toFixed(0)} ${((q[k][0] + q[k + 1][0]) / 2).toFixed(0)} ${((q[k][1] + q[k + 1][1]) / 2).toFixed(0)}`;
    out[left ? 'left' : 'right'] += `<path d="${d}" stroke="${INK}" stroke-width="${(1.4 + rnd() * 1.6).toFixed(1)}" opacity="${(fade * (0.4 + rnd() * 0.5)).toFixed(2)}"/>`;
  }
  return out;
}

const art = VARIANT === 'lanes' ? laneArt() : flowArt();
const half = (x, body) => `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linecap="round" stroke-linejoin="round" viewBox="${x} 0 ${W / 2} ${H}">${body}</svg>`;
writeFileSync(new URL('../public/streams-left.svg', import.meta.url), half(0, art.left));
writeFileSync(new URL('../public/streams-right.svg', import.meta.url), half(W / 2, art.right));
console.log('streams written:', VARIANT);
