import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ENCRYPT_PALETTES,
  SHAPES,
  SHAPE_COUNT,
  LAYOUT_COUNT,
  identiconSvg,
  renderShape,
  sha256Sync
} from '../src/lib/identicon.ts';

const out = fileURLToPath(new URL('./identicon-combinations-preview.html', import.meta.url));
const names = ['Hbitá Vydra', 'Tichý Sokol', 'Rychlá Liška', 'Moudrý Kos', 'Zlatá Sova', 'Divoký Vlk', 'Chytrý Bobr', 'Noční Rys'];

const sample = (i) => {
  const key = createHash('sha256').update(`sample-${i}`).digest('hex').slice(0, 16);
  return { key, name: names[i % names.length] };
};

const shapeSheet = SHAPES.map((s, i) => {
  const [bg, f] = ENCRYPT_PALETTES[0].colors;
  const accent = ENCRYPT_PALETTES[0].colors[3];
  const tiles = [0, 1, 2, 3]
    .map(
      (r) =>
        `<svg viewBox="0 0 50 50" width="72" height="72"><rect width="50" height="50" fill="${bg}"/><g transform="rotate(${r * 90} 25 25)">${renderShape(i, f, accent)}</g></svg>`
    )
    .join('');
  return `<div class="shape"><div class="row">${tiles}</div><span>${i} · ${s.name}</span></div>`;
}).join('');

const paletteSheet = ENCRYPT_PALETTES.map(
  (p) =>
    `<div class="pal"><div class="sw">${p.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</div><span>${p.name}</span></div>`
).join('');

const layoutSeeds = new Map();
for (let i = 0; layoutSeeds.size < LAYOUT_COUNT && i < 5000; i++) {
  const s = sample(i);
  const mode = sha256Sync(`${s.key}:${s.name}`)[1] % LAYOUT_COUNT;
  if (!layoutSeeds.has(mode)) layoutSeeds.set(mode, s);
}
const layoutLabels = ['free', 'mirror left-right', 'mirror top-bottom', 'pinwheel', 'checker', 'kaleidoscope'];
const layoutSheet = [...layoutSeeds.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([m, s]) => `<div class="pal"><div class="av" style="width:96px;height:96px">${identiconSvg(s, 96)}</div><span>${m} · ${layoutLabels[m]}</span></div>`)
  .join('');

const big = Array.from({ length: 12 }, (_, i) => `<div class="av" style="width:128px;height:128px">${identiconSvg(sample(i + 3000), 128)}</div>`).join("");
const count = 480;
const grid = Array.from({ length: count }, (_, i) => {
  const s = sample(i);
  return `<div class="av" title="${s.name}">${identiconSvg(s, 64)}</div>`;
}).join('');

const small = Array.from({ length: 24 }, (_, i) => `<div class="av" style="width:24px;height:24px">${identiconSvg(sample(i + 1000), 24)}</div>`).join('');
const mid = Array.from({ length: 16 }, (_, i) => `<div class="av" style="width:34px;height:34px">${identiconSvg(sample(i + 2000), 34)}</div>`).join('');

const perCell = SHAPE_COUNT * 4 * 5 * 4 * 3;
const total = ENCRYPT_PALETTES.length * (perCell ** 4 + perCell ** 3 * 2 + perCell * 4 + perCell ** 2 + perCell);

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Identicon combinations</title>
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:24px;background:#fff;color:#18181b}
.dark{background:#09090b;color:#f4f4f5}
h1,h2{margin:24px 0 8px}
.shapes,.pals,.grid{display:flex;flex-wrap:wrap;gap:12px}
.shape{display:flex;flex-direction:column;gap:4px}.row{display:flex;gap:2px}
.pal{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.sw{display:flex}.sw i{width:28px;height:28px;display:block}
.av{width:64px;height:64px;border-radius:9999px;overflow:hidden;line-height:0;flex:none}
.av svg{width:100%;height:100%}
.strip{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.panel{padding:12px;border-radius:12px;margin:8px 0}
.light{background:#fff;border:1px solid #d4d4d8}.darkp{background:#09090b;color:#f4f4f5;border:1px solid #3f3f46}
</style>
<h1>Identicon combinations</h1>
<p>${ENCRYPT_PALETTES.length} palettes of 5 colors, ${SHAPE_COUNT} shapes with 4 rotations, ${LAYOUT_COUNT} layouts. One background color per avatar, and each shape picks its own color and accent from the palette with enforced contrast. Roughly ${total.toExponential(1)} distinct avatars.</p>
<h2>Shapes (4 rotations each)</h2><div class="shapes">${shapeSheet}</div>
<h2>Palettes</h2><div class="pals">${paletteSheet}</div>
<h2>Layouts</h2><div class="pals">${layoutSheet}</div>
<h2>Large</h2><div class="grid">${big}</div>
<h2>Real sizes (24 px, 34 px) on light and dark</h2>
<div class="panel light"><div class="strip">${small}${mid}</div></div>
<div class="panel darkp"><div class="strip">${small}${mid}</div></div>
<h2>${count} avatars from key and name</h2><div class="grid">${grid}</div>
</html>`;

writeFileSync(out, html);
console.log(`wrote ${out}`, { total });
