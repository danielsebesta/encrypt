// Turns a flow-line SVG into the grayscale source the ASCII background samples: stroke brightness from the original
// colour, thicker strokes, black ground, dense end at the top; --flip gives the copy that grows up from the footer.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const [input, output, mode] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: node scripts/build-flow-ascii-source.mjs <in.svg> <out.webp> [--flip]');

let svg = readFileSync(input, 'utf8');
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};
const lums = [...svg.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)].map((m) => lum(m[1]));
const lo = Math.min(...lums);
const hi = Math.max(...lums);
svg = svg
  .replace(/<rect[^>]*>(<\/rect>)?/, '<rect width="1920" height="1080" fill="#000"></rect>')
  .replace(/stroke="(#[0-9a-fA-F]{6})"/g, (_, c) => {
    const g = Math.round(110 + ((lum(c) - lo) / (hi - lo || 1)) * 145);
    const h = g.toString(16).padStart(2, '0');
    return `stroke="#${h}${h}${h}"`;
  })
  .replace(/stroke-width="([\d.]+)"/g, (_, w) => `stroke-width="${(Number(w) * 1.2 + 1.6).toFixed(1)}"`)
  .replace(/ opacity="[\d.]+"/g, '');

let image = sharp(Buffer.from(svg), { density: 72 }).resize(1600, 900);
if (mode === '--flip') image = image.flip();
await image
  .webp({ quality: 80 })
  .toFile(output);
