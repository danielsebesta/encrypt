// Regenerates every brand icon from one color: `--color-brand` in src/styles/global.css.
// Usage: pnpm run build:icons
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const file = (p) => fileURLToPath(new URL(p, root));
const css = readFileSync(file('src/styles/global.css'), 'utf8');
const BRAND = css.match(/--color-brand:\s*(#[0-9a-f]{6})/i)?.[1];
const DARK_BG = css.match(/html\.dark\s*\{[^}]*?--bg:\s*(#[0-9a-f]{6})/is)?.[1];
if (!BRAND || !DARK_BG) throw new Error('Could not read --color-brand and the dark --bg from global.css');

const recolor = (svg) => svg.replace(/fill="#[0-9a-f]{6}"/gi, `fill="${BRAND}"`);
const DARK_ACCENT = css.match(/html\.dark\s*\{[^}]*?--accent:\s*(#[0-9a-f]{6})/is)?.[1] ?? BRAND;
const glyphPath = readFileSync(file('public/favicon.svg'), 'utf8').match(/\sd="([^"]+)"/)[1];
const VIEWBOX = '1.7 1.9 60.6 60.6';
const iconFor = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${VIEWBOX}"><path fill="${fill}" fill-rule="evenodd" d="${glyphPath}"/></svg>`;
const icon = iconFor(BRAND);
writeFileSync(file('public/favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${VIEWBOX}"><style>path{fill:${BRAND}}@media (prefers-color-scheme:dark){path{fill:${DARK_ACCENT}}}</style><path fill-rule="evenodd" d="${glyphPath}"/></svg>
`);
const big = readFileSync(file('public/encryptclick_icon.svg'), 'utf8');
writeFileSync(file('public/encryptclick_icon.svg'), recolor(big));
const logo = readFileSync(file('public/encryptclick.svg'), 'utf8');
writeFileSync(file('public/encryptclick.svg'), logo.replace(/stroke:#[0-9a-f]{6}/gi, `stroke:${BRAND}`));

async function bare(size) {
  return sharp(Buffer.from(icon), { density: 384 }).resize(size, size, { fit: 'contain', background: '#00000000' }).png({ compressionLevel: 9 }).toBuffer();
}

async function tile(size, scale) {
  const tileIcon = iconFor(BRAND);
  const inner = Math.round(size * scale);
  const mark = await sharp(Buffer.from(tileIcon), { density: 384 }).resize(inner, inner, { fit: 'contain', background: '#00000000' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: DARK_BG } })
    .composite([{ input: mark, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const out = {
  'public/favicon-96x96.png': await bare(96),
  'public/apple-touch-icon.png': await tile(180, 0.7),
  'public/web-app-manifest-192x192.png': await tile(192, 0.6),
  'public/web-app-manifest-512x512.png': await tile(512, 0.6),
};
for (const [p, buf] of Object.entries(out)) writeFileSync(file(p), buf);

const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => bare(s)));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  head.writeUInt8(s, at);
  head.writeUInt8(s, at + 1);
  head.writeUInt16LE(1, at + 4);
  head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(pngs[i].length, at + 8);
  head.writeUInt32LE(offset, at + 12);
  offset += pngs[i].length;
});
writeFileSync(file('public/favicon.ico'), Buffer.concat([head, ...pngs]));

const manifestPath = file('public/site.webmanifest');
writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace(/("(?:theme|background)_color": ")#[0-9a-f]{6}/gi, `$1${DARK_BG}`));

console.log(`Icons rebuilt with ${BRAND} on ${DARK_BG}`);
