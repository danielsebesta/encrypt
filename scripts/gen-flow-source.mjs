import sharp from 'sharp';

const W = 1920;
const H = 1080;
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const angle = (x, y) =>
  0.34 * Math.sin(x * 0.0042 + y * 0.0061 + 0.8) +
  0.22 * Math.sin(x * 0.0093 - y * 0.0047 + 2.1) +
  0.1 * Math.sin(x * 0.017 + y * 0.011 + 4.0) -
  0.16;

function trace(x, y, dir, steps, step) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = angle(x, y);
    x += Math.cos(a) * step * dir;
    y += Math.sin(a) * step * dir;
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) break;
    pts.push([x, y]);
  }
  return pts;
}

const paths = [];
for (let i = 0; i < 120; i++) {
  const x = rnd() * W;
  const y = rnd() * H;
  const back = trace(x, y, -1, 50 + Math.floor(rnd() * 70), 7).reverse();
  const fwd = trace(x, y, 1, 70 + Math.floor(rnd() * 110), 7);
  const pts = [...back, [x, y], ...fwd];
  if (pts.length < 12) continue;
  const fade = Math.max(0.12, 1 - (y / H) * 0.85);
  const alpha = (0.35 + rnd() * 0.65) * fade;
  const width = 5 + rnd() * 5;
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
  paths.push(`<path d="${d}" stroke="#fff" stroke-opacity="${alpha.toFixed(2)}" stroke-width="${width.toFixed(1)}"/>`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#000"/><g fill="none" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g></svg>`;

await sharp(Buffer.from(svg)).webp({ quality: 82 }).toFile(new URL('../public/flow-ascii-src.webp', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
console.log('flow source written', paths.length, 'lines');
