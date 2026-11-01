export type IdenticonSeed =
  | string
  | { a: number; n: number; h: number }
  | { key?: string; name?: string }
  | null
  | undefined;

import { ENCRYPT_PALETTES, type Palette } from './identiconPalettes';

export { ENCRYPT_PALETTES, type Palette };

/** Fast, dependency-free synchronous UTF-8 encoder */
function utf8ToBytes(str: string): string {
  let res = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) {
      res += String.fromCharCode(c);
    } else if (c < 2048) {
      res += String.fromCharCode((c >> 6) | 192);
      res += String.fromCharCode((c & 63) | 128);
    } else {
      res += String.fromCharCode((c >> 12) | 224);
      res += String.fromCharCode(((c >> 6) & 63) | 128);
      res += String.fromCharCode((c & 63) | 128);
    }
  }
  return res;
}

/** Synchronous, pure JS SHA-256 implementation producing 32 pseudo-random bytes */
export function sha256Sync(input: string): Uint8Array {
  const ascii = utf8ToBytes(input);
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, boolean> = {};

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  let padded = ascii + '\x80';
  while (padded.length % 64 - 56) padded += '\x00';
  for (let i = 0; i < padded.length; i++) {
    const j = padded.charCodeAt(i);
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength | 0;

  for (let j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice();

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash.unshift((temp1 + temp2) | 0);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      bytes[i * 4 + (3 - j)] = (hash[i] >> (j * 8)) & 255;
    }
  }
  return bytes;
}

export function normalizeSeed(seed: IdenticonSeed): string {
  if (!seed) return 'encrypt:default';
  if (typeof seed === 'string') return seed;
  if (!('a' in seed)) {
    return `${seed.key || ''}:${seed.name || ''}`;
  }
  return `alias:${seed.a}-${seed.n}-${seed.h}`;
}

type Draw = (f: string, g: string) => string;

const fill = (d: string, c: string) => `<path d="${d}" fill="${c}"/>`;

/** Every shape is drawn in a 50x50 cell, stays inside it, and may use a second accent color. */
export const SHAPES: readonly { name: string; draw: Draw }[] = [
  { name: 'quarter', draw: (f) => fill('M0 0H50A50 50 0 0 1 0 50Z', f) },
  { name: 'triangle', draw: (f) => fill('M0 0H50L0 50Z', f) },
  { name: 'dome', draw: (f) => fill('M0 50A25 25 0 0 1 50 50Z', f) },
  { name: 'disk', draw: (f) => `<circle cx="25" cy="25" r="21" fill="${f}"/>` },
  { name: 'ring', draw: (f) => `<circle cx="25" cy="25" r="16.5" fill="none" stroke="${f}" stroke-width="9"/>` },
  { name: 'diamond', draw: (f) => fill('M25 3L47 25L25 47L3 25Z', f) },
  { name: 'plus', draw: (f) => fill('M19 5H31V19H45V31H31V45H19V31H5V19H19Z', f) },
  { name: 'pill', draw: (f) => `<rect x="3" y="16" width="44" height="18" rx="9" fill="${f}"/>` },
  { name: 'chamfer', draw: (f) => fill('M16 0H50V50H0V16Z', f) },
  { name: 'arch', draw: (f) => fill('M7 50V25A18 18 0 0 1 43 25V50Z', f) },
  { name: 'hexagon', draw: (f) => fill('M25 3L44 14V36L25 47L6 36V14Z', f) },
  { name: 'split', draw: (f, g) => `${fill('M0 0H50V50Z', g)}${fill('M0 0V50H50Z', f)}` },
  { name: 'leaf', draw: (f) => fill('M0 50A50 50 0 0 1 50 0A50 50 0 0 1 0 50Z', f) },
  { name: 'steps', draw: (f) => fill('M0 50V34H16V18H32V0H50V50Z', f) },
  {
    name: 'sparkle',
    draw: (f) => fill('M25 2C27 15 35 23 48 25C35 27 27 35 25 48C23 35 15 27 2 25C15 23 23 15 25 2Z', f)
  },
  {
    name: 'eclipse',
    draw: (f, g) => `<circle cx="25" cy="25" r="21" fill="${f}"/><circle cx="31" cy="25" r="13" fill="${g}"/>`
  },
  { name: 'checker', draw: (f) => fill('M0 0H25V25H0ZM25 25H50V50H25Z', f) },
  {
    name: 'sun',
    draw: (f, g) => `${fill('M0 0H50A50 50 0 0 1 0 50Z', f)}<circle cx="17" cy="17" r="9" fill="${g}"/>`
  },
  { name: 'peak', draw: (f) => fill('M25 5L45 45H5Z', f) },
  {
    name: 'yin',
    draw: (f, g) => `<rect width="25" height="50" fill="${f}"/>${fill('M25 0A25 25 0 0 1 25 50Z', g)}`
  },
  {
    name: 'nested',
    draw: (f, g) => `${fill('M0 0H50A50 50 0 0 1 0 50Z', f)}${fill('M0 0H26A26 26 0 0 1 0 26Z', g)}`
  },
  { name: 'half', draw: (f) => fill('M0 0H25V50H0Z', f) },
  { name: 'drop', draw: (f) => fill('M0 0H25A25 25 0 0 1 50 25A25 25 0 0 1 25 50A25 25 0 0 1 0 25Z', f) },
  { name: 'band', draw: (f) => fill('M0 25L25 0H50L0 50Z', f) },
  { name: 'lens', draw: (f) => fill('M25 0A35 35 0 0 1 25 50A35 35 0 0 1 25 0Z', f) },
  { name: 'cross', draw: (f) => fill('M0 0H12L50 38V50H38L0 12ZM38 0H50V12L12 50H0V38Z', f) }
];

export const SHAPE_COUNT = SHAPES.length;
export const LAYOUT_COUNT = 6;

const luminanceCache = new Map<string, number>();

function luminance(hex: string): number {
  let l = luminanceCache.get(hex);
  if (l === undefined) {
    const lin = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    l = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    luminanceCache.set(hex, l);
  }
  return l;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function firstReadable(options: string[], against: string, min: number): string {
  let best = options[0];
  let bestRatio = 0;
  for (const c of options) {
    const r = contrastRatio(c, against);
    if (r >= min) return c;
    if (r > bestRatio) {
      best = c;
      bestRatio = r;
    }
  }
  return best;
}

interface Cell {
  shape: number;
  rot: number;
  f: string;
  g: string;
  sx: 1 | -1;
  sy: 1 | -1;
}

type Slot = { src: number; fx?: boolean; fy?: boolean; turn?: number };

const LAYOUTS: readonly (readonly Slot[])[] = [
  [{ src: 0 }, { src: 1 }, { src: 2 }, { src: 3 }],
  [{ src: 0 }, { src: 0, fx: true }, { src: 2 }, { src: 2, fx: true }],
  [{ src: 0 }, { src: 1 }, { src: 0, fy: true }, { src: 1, fy: true }],
  [{ src: 0 }, { src: 0, turn: 1 }, { src: 0, turn: 3 }, { src: 0, turn: 2 }],
  [{ src: 0 }, { src: 1 }, { src: 1 }, { src: 0 }],
  [{ src: 0 }, { src: 0, fx: true }, { src: 0, fy: true }, { src: 0, fx: true, fy: true }]
];

function pickColors(colors: readonly string[], bg: string, b: Uint8Array, at: number): { f: string; g: string } {
  const pool = colors.filter((c) => c !== bg);
  const fo = b[at] % pool.length;
  const f = firstReadable([...pool.slice(fo), ...pool.slice(0, fo)], bg, 1.6);
  const rest = pool.filter((c) => c !== f);
  const go = b[at + 1] % rest.length;
  const g = firstReadable([...rest.slice(go), ...rest.slice(0, go)], f, 1.5);
  return { f, g };
}

/** Geometry follows the layout, but every cell draws its own colors so symmetric avatars still alternate. */
function layoutCells(b: Uint8Array, colors: readonly string[], bg: string): Cell[] {
  const slots = LAYOUTS[b[1] % LAYOUT_COUNT];
  const shapeOf = (k: number) => ({ shape: b[2 + k * 2] % SHAPE_COUNT, rot: b[3 + k * 2] % 4 });
  return slots.map((slot, k) => {
    const { shape, rot } = shapeOf(slot.src);
    const { f, g } = pickColors(colors, bg, b, 10 + k * 2);
    return { shape, rot: (rot + (slot.turn ?? 0)) % 4, f, g, sx: slot.fx ? -1 : 1, sy: slot.fy ? -1 : 1 };
  });
}

export function renderShape(shape: number, f: string, g: string): string {
  return SHAPES[shape % SHAPE_COUNT].draw(f, g);
}

const INSET = 0.9;

function cellMarkup(cell: Cell, x: number, y: number): string {
  const tx = x + (cell.sx < 0 ? 50 : 0);
  const ty = y + (cell.sy < 0 ? 50 : 0);
  const transform = `translate(${tx} ${ty}) scale(${cell.sx} ${cell.sy}) translate(25 25) rotate(${cell.rot * 90}) scale(${INSET}) translate(-25 -25)`;
  return `<g transform="${transform}">${renderShape(cell.shape, cell.f, cell.g)}</g>`;
}

const CELL_POSITIONS = [
  [0, 0],
  [50, 0],
  [0, 50],
  [50, 50]
];

/** One calm background, four floating shapes with a gap between them, and a slight zoom so no corner seam shows. */
export function identiconSvg(seed: IdenticonSeed, size?: number): string {
  const bytes = sha256Sync(normalizeSeed(seed));
  const pal = ENCRYPT_PALETTES[((bytes[22] << 8) | bytes[23]) % ENCRYPT_PALETTES.length];
  const bg = pal.colors[bytes[0] % 5];
  const cells = layoutCells(bytes, pal.colors, bg);
  const body = cells.map((cell, i) => cellMarkup(cell, CELL_POSITIONS[i][0], CELL_POSITIONS[i][1])).join('');
  const sizeAttrs = size ? ` width="${size}" height="${size}"` : '';
  return `<svg viewBox="4 4 92 92"${sizeAttrs} xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><rect x="0" y="0" width="100" height="100" fill="${bg}"/>${body}</svg>`;
}

export function identiconDataUri(seed: IdenticonSeed): string {
  return `data:image/svg+xml,${encodeURIComponent(identiconSvg(seed))}`;
}

export function identiconBackground(seed: IdenticonSeed): string {
  return `url("${identiconDataUri(seed)}") center / cover no-repeat`;
}
