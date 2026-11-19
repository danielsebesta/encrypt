import sharp from 'sharp';

let seed = 5;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function art(W, H, band, count) {
  const ang = (x, y) => Math.PI / 2 + 0.9 * Math.sin(x * 0.006 + y * 0.004) + 0.5 * Math.sin(y * 0.011 - x * 0.003 + 1.7);
  const edge = (x) => Math.min(x, W - x);
  let out = '';
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
    const q = pts.filter((_, k) => k % 2 === 0);
    let d = `M${q[0][0].toFixed(0)} ${q[0][1].toFixed(0)}`;
    for (let k = 1; k < q.length - 1; k++) d += `Q${q[k][0].toFixed(0)} ${q[k][1].toFixed(0)} ${((q[k][0] + q[k + 1][0]) / 2).toFixed(0)} ${((q[k][1] + q[k + 1][1]) / 2).toFixed(0)}`;
    out += `<path d="${d}" stroke="#fff" stroke-opacity="${(fade * (0.45 + rnd() * 0.55)).toFixed(2)}" stroke-width="${(4 + rnd() * 5).toFixed(1)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#000"/><g fill="none" stroke-linecap="round" stroke-linejoin="round">${out}</g></svg>`;
}

const target = (name) => new URL(`../public/${name}`, import.meta.url);
for (const [name, W, H, band, count] of [['flow-ascii-src.webp', 1920, 1080, 420, 200], ['flow-ascii-src-compact.webp', 1920, 1080, 700, 240], ['flow-ascii-src-portrait.webp', 900, 1600, 300, 150]]) {
  await sharp(Buffer.from(art(W, H, band, count))).webp({ quality: 80 }).toFile(target(name).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
}
console.log('flow sources written');
