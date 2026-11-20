// Regenerates every brand icon from the palette in src/styles/global.css: the light and dark `--accent`
// for the favicon and the nav mark, the dark `--accent` on the dark `--bg` for app icons.
// Usage: pnpm run build:brand-icons (tsx, the colour utilities ship extensionless ESM imports)
// Favicons / "any" icons stay transparent. Maskable and Apple touch icons are full-bleed
// squares: the launcher or iOS applies its own mask, and transparent corners would show
// as white plates. The monochrome icon is for themed (Material You) launchers.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { argbFromHex, hexFromArgb, Hct, SchemeTonalSpot } from '@material/material-color-utilities';

const root = new URL('../', import.meta.url);
const file = (p) => fileURLToPath(new URL(p, root));
const css = readFileSync(file('src/styles/global.css'), 'utf8');
const LIGHT_ACCENT = css.match(/:root\s*\{[^}]*?--accent:\s*(#[0-9a-f]{6})/is)?.[1];
const DARK_ACCENT = css.match(/html\.dark\s*\{[^}]*?--accent:\s*(#[0-9a-f]{6})/is)?.[1];
const DARK_BG = css.match(/html\.dark\s*\{[^}]*?--bg:\s*(#[0-9a-f]{6})/is)?.[1];
const SEED = css.match(/--color-brand:\s*(#[0-9a-f]{6})/i)?.[1];
if (!LIGHT_ACCENT || !DARK_ACCENT || !DARK_BG || !SEED) throw new Error('Could not read the accents, the dark --bg and --color-brand from global.css');
const MID = hexFromArgb(new SchemeTonalSpot(Hct.fromInt(argbFromHex(SEED)), false, 0).primaryPalette.tone(55)).toLowerCase();

const glyphPath = readFileSync(file('public/favicon.svg'), 'utf8').match(/\sd="([^"]+)"/)[1];
const VIEWBOX = '1.7 1.9 60.6 60.6';
const iconFor = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${VIEWBOX}"><path fill="${fill}" fill-rule="evenodd" d="${glyphPath}"/></svg>`;
const icon = iconFor(MID);

writeFileSync(file('public/favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${VIEWBOX}"><style>path{fill:${LIGHT_ACCENT}}@media (prefers-color-scheme:dark){path{fill:${DARK_ACCENT}}}</style><path fill-rule="evenodd" d="${glyphPath}"/></svg>
`);

const big = readFileSync(file('public/encryptclick_icon.svg'), 'utf8');
const bigPath = big.match(/\sd="([^"]+)"/)[1];
const bigView = big.match(/viewBox="([^"]+)"/)?.[1] ?? '117 45 278 423';
writeFileSync(
  file('public/encryptclick_icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="${bigView}"><style>path{fill:${LIGHT_ACCENT}}@media (prefers-color-scheme:dark){path{fill:${DARK_ACCENT}}}</style><path fill="${LIGHT_ACCENT}" fill-rule="evenodd" d="${bigPath}"/></svg>
`,
);

const logo = readFileSync(file('public/encryptclick.svg'), 'utf8');
writeFileSync(file('public/encryptclick.svg'), logo.replace(/stroke:#[0-9a-f]{6}/gi, `stroke:${LIGHT_ACCENT}`).replace(/fill:#[0-9a-f]{6}/gi, `fill:${LIGHT_ACCENT}`));

/** Transparent square with the brand glyph. */
async function bare(size) {
  return sharp(Buffer.from(icon), { density: 384 })
    .resize(size, size, { fit: 'contain', background: '#00000000' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Full-bleed dark square with the glyph centred; `scale` keeps it inside the mask safe zone. */
async function plate(size, scale) {
  const inner = Math.round(size * scale);
  const mark = await sharp(Buffer.from(iconFor(DARK_ACCENT)), { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: '#00000000' })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: DARK_BG } })
    .composite([{ input: mark, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** White glyph on transparent, inside the safe zone; the system tints it. */
async function monochrome(size) {
  const inner = Math.round(size * 0.5);
  const mark = await sharp(Buffer.from(iconFor('#ffffff')), { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: '#00000000' })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: '#00000000' } })
    .composite([{ input: mark, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const out = {
  'public/favicon-96x96.png': await bare(96),
  'public/apple-touch-icon.png': await plate(180, 0.6),
  'public/web-app-manifest-192x192.png': await plate(192, 0.5),
  'public/web-app-manifest-512x512.png': await plate(512, 0.5),
  'public/web-app-manifest-monochrome-512x512.png': await monochrome(512),
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
manifest.prefer_related_applications = false;
manifest.launch_handler = manifest.launch_handler || { client_mode: ['focus-existing', 'navigate-existing', 'auto'] };
manifest.icons = [
  { src: '/web-app-manifest-192x192-any.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/web-app-manifest-512x512-any.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: '/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  { src: '/web-app-manifest-monochrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
  { src: '/favicon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
  { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
];
for (const shortcut of manifest.shortcuts ?? []) {
  shortcut.icons = [
    { src: '/web-app-manifest-192x192-any.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  ];
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Icons rebuilt: favicon ${LIGHT_ACCENT}/${DARK_ACCENT}, transparent ${MID}, ${DARK_ACCENT} on ${DARK_BG} plates, monochrome`);
