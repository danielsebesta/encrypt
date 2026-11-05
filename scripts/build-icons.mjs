// Regenerates every brand icon from one color: `--color-brand` in src/styles/global.css.
// Usage: pnpm run build:icons
// Favicons / "any" icons stay transparent. Maskable + Apple touch use a circular disc
// so home-screen masks stay intentional without a square plate.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const file = (p) => fileURLToPath(new URL(p, root));
const css = readFileSync(file('src/styles/global.css'), 'utf8');
const BRAND = css.match(/--color-brand:\s*(#[0-9a-f]{6})/i)?.[1];
const DARK_BG = css.match(/html\.dark\s*\{[^}]*?--bg:\s*(#[0-9a-f]{6})/is)?.[1];
if (!BRAND || !DARK_BG) throw new Error('Could not read --color-brand and the dark --bg from global.css');

const DARK_ACCENT = css.match(/html\.dark\s*\{[^}]*?--accent:\s*(#[0-9a-f]{6})/is)?.[1] ?? BRAND;
const glyphPath = readFileSync(file('public/favicon.svg'), 'utf8').match(/\sd="([^"]+)"/)[1];
const VIEWBOX = '1.7 1.9 60.6 60.6';
const iconFor = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${VIEWBOX}"><path fill="${fill}" fill-rule="evenodd" d="${glyphPath}"/></svg>`;
const icon = iconFor(BRAND);

writeFileSync(file('public/favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${VIEWBOX}"><style>path{fill:${BRAND}}@media (prefers-color-scheme:dark){path{fill:${DARK_ACCENT}}}</style><path fill-rule="evenodd" d="${glyphPath}"/></svg>
`);

const big = readFileSync(file('public/encryptclick_icon.svg'), 'utf8');
const bigPath = big.match(/\sd="([^"]+)"/)[1];
const bigView = big.match(/viewBox="([^"]+)"/)?.[1] ?? '117 45 278 423';
writeFileSync(
  file('public/encryptclick_icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${bigView}"><style>path{fill:${BRAND}}@media (prefers-color-scheme:dark){path{fill:${DARK_ACCENT}}}</style><path fill="${BRAND}" fill-rule="evenodd" d="${bigPath}"/></svg>
`,
);

const logo = readFileSync(file('public/encryptclick.svg'), 'utf8');
writeFileSync(file('public/encryptclick.svg'), logo.replace(/stroke:#[0-9a-f]{6}/gi, `stroke:${BRAND}`).replace(/fill:#00bc7d/gi, `fill:${BRAND}`));

/** Transparent square with the brand glyph. */
async function bare(size) {
  return sharp(Buffer.from(icon), { density: 384 })
    .resize(size, size, { fit: 'contain', background: '#00000000' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Transparent canvas + circular dark disc + glyph. Used where a plate is required
 * (Apple touch, maskable). Corners stay transparent; launchers that circle-crop look right.
 * Glyph stays inside the maskable safe zone (~80% of the disc).
 */
async function circle(size, scale = 0.58) {
  const inner = Math.round(size * scale);
  const mark = await sharp(Buffer.from(iconFor(BRAND)), { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: '#00000000' })
    .png()
    .toBuffer();
  const disc = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${DARK_BG}"/>` +
      `</svg>`,
  );
  return sharp(disc)
    .png()
    .composite([{ input: mark, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const out = {
  'public/favicon-96x96.png': await bare(96),
  'public/apple-touch-icon.png': await circle(180, 0.62),
  'public/web-app-manifest-192x192.png': await circle(192, 0.58),
  'public/web-app-manifest-512x512.png': await circle(512, 0.58),
  'public/web-app-manifest-192x192-any.png': await bare(192),
  'public/web-app-manifest-512x512-any.png': await bare(512),
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
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.theme_color = DARK_BG;
manifest.background_color = DARK_BG;
manifest.lang = manifest.lang || 'en';
manifest.dir = manifest.dir || 'ltr';
manifest.launch_handler = manifest.launch_handler || { client_mode: ['focus-existing', 'navigate-existing', 'auto'] };
manifest.icons = [
  { src: '/web-app-manifest-192x192-any.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/web-app-manifest-512x512-any.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: '/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  { src: '/favicon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
  { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
];
for (const shortcut of manifest.shortcuts ?? []) {
  shortcut.icons = [
    { src: '/web-app-manifest-192x192-any.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  ];
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Icons rebuilt with ${BRAND}; transparent any + circular ${DARK_BG} plates`);
