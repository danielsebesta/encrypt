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

type Draw = (c: string) => string;

/**
 * Side / corner tiles in a unit square. Drawn like Forgejo/Gitea blocks so 90° rotation
 * and left-right mirroring stay readable inside a circular crop.
 */
export const SHAPES: readonly { name: string; draw: Draw }[] = [
  { name: 'tri-br', draw: (c) => `<path d="M0 1H1V0Z" fill="${c}"/>` },
  { name: 'tri-bl', draw: (c) => `<path d="M0 0V1H1Z" fill="${c}"/>` },
  { name: 'half-b', draw: (c) => `<path d="M0 .5H1V1H0Z" fill="${c}"/>` },
  { name: 'half-l', draw: (c) => `<path d="M0 0H.5V1H0Z" fill="${c}"/>` },
  { name: 'quarter', draw: (c) => `<path d="M0 0H1A1 1 0 0 1 0 1Z" fill="${c}"/>` },
  { name: 'corner', draw: (c) => `<path d="M0 0H1V.35H.35V1H0Z" fill="${c}"/>` },
  { name: 'band', draw: (c) => `<path d="M0 .28H1V.72H0Z" fill="${c}"/>` },
  { name: 'stripe', draw: (c) => `<path d="M.28 0H.72V1H.28Z" fill="${c}"/>` },
  { name: 'wedge', draw: (c) => `<path d="M0 0H1L.5 1Z" fill="${c}"/>` },
  { name: 'steps', draw: (c) => `<path d="M0 1V.66H.33V.33H.66V0H1V1Z" fill="${c}"/>` },
  { name: 'notch', draw: (c) => `<path d="M0 0H1V1H0ZM.25 .25V.75H.75V.25Z" fill-rule="evenodd" fill="${c}"/>` },
  { name: 'peak', draw: (c) => `<path d="M0 1L.5 0L1 1Z" fill="${c}"/>` },
  { name: 'slash', draw: (c) => `<path d="M0 .2L.2 0H1L0 1V.8Z" fill="${c}"/>` },
  { name: 'dot-row', draw: (c) => `<circle cx=".25" cy=".5" r=".18" fill="${c}"/><circle cx=".75" cy=".5" r=".18" fill="${c}"/>` },
];

/** Center tiles: denser motifs that sit fully inside the circular crop. */
export const CENTER_SHAPES: readonly { name: string; draw: Draw }[] = [
  { name: 'disk', draw: (c) => `<circle cx=".5" cy=".5" r=".42" fill="${c}"/>` },
  { name: 'ring', draw: (c) => `<circle cx=".5" cy=".5" r=".34" fill="none" stroke="${c}" stroke-width=".22"/>` },
  { name: 'diamond', draw: (c) => `<path d="M.5 .08L.92 .5L.5 .92L.08 .5Z" fill="${c}"/>` },
  { name: 'plus', draw: (c) => `<path d="M.38 .12H.62V.38H.88V.62H.62V.88H.38V.62H.12V.38H.38Z" fill="${c}"/>` },
  { name: 'hex', draw: (c) => `<path d="M.5 .08L.88 .29V.71L.5 .92L.12 .71V.29Z" fill="${c}"/>` },
  { name: 'square', draw: (c) => `<rect x=".16" y=".16" width=".68" height=".68" rx=".08" fill="${c}"/>` },
  { name: 'sparkle', draw: (c) => `<path d="M.5 .06C.54 .32 .68 .46 .94 .5C.68 .54 .54 .68 .5 .94C.46 .68 .32 .54 .06 .5C.32 .46 .46 .32 .5 .06Z" fill="${c}"/>` },
  { name: 'flower', draw: (c) => `<circle cx=".5" cy=".28" r=".18" fill="${c}"/><circle cx=".5" cy=".72" r=".18" fill="${c}"/><circle cx=".28" cy=".5" r=".18" fill="${c}"/><circle cx=".72" cy=".5" r=".18" fill="${c}"/><circle cx=".5" cy=".5" r=".14" fill="${c}"/>` },
  { name: 'target', draw: (c) => `<circle cx=".5" cy=".5" r=".42" fill="${c}"/><circle cx=".5" cy=".5" r=".2" fill="none" stroke="${c}" stroke-width=".08" opacity=".35"/>` },
  { name: 'octagon', draw: (c) => `<path d="M.3 .08H.7L.92 .3V.7L.7 .92H.3L.08 .7V.3Z" fill="${c}"/>` },
];

export const SHAPE_COUNT = SHAPES.length;
export const CENTER_COUNT = CENTER_SHAPES.length;
export const LAYOUT_COUNT = 1;

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

/** Forgejo-style: one calm field + one strong ink, optionally a second ink for the center. */
function pickColors(pal: Palette, b: Uint8Array): { bg: string; fg: string; accent: string } {
  const ranked = [...pal.colors].sort((a, c) => luminance(a) - luminance(c));
  const darkField = b[0] % 2 === 0;
  const bg = darkField ? ranked[0] : ranked[ranked.length - 1];
  const pool = ranked.filter((c) => c !== bg);
  const fo = b[1] % pool.length;
  const fg = firstReadable([...pool.slice(fo), ...pool.slice(0, fo)], bg, 2.4);
  const rest = pool.filter((c) => c !== fg);
  const ao = b[2] % Math.max(rest.length, 1);
  const accent = rest.length
    ? firstReadable([...rest.slice(ao), ...rest.slice(0, ao)], bg, 2.0)
    : fg;
  return { bg, fg, accent };
}

export function renderShape(shape: number, f: string, g = f): string {
  void g;
  return SHAPES[shape % SHAPE_COUNT].draw(f);
}

const SIZE = 100;
/** Keep tiles inside the inscribed circle so CSS `rounded-full` does not clip the motif away. */
const PAD = 10;
const GRID = SIZE - PAD * 2;
const CELL = GRID / 3;
/** Gap between tiles so the grid reads cleanly at 24–48px. */
const TILE = CELL * 0.86;

function placeTile(col: number, row: number, markup: string, angle: number, mirrorX = false): string {
  const cx = PAD + col * CELL + CELL / 2;
  const cy = PAD + row * CELL + CELL / 2;
  const sx = (mirrorX ? -TILE : TILE).toFixed(2);
  const sy = TILE.toFixed(2);
  // Center the unit tile, flip/scale, rotate, then park on the grid.
  return `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${angle * 90}) scale(${sx} ${sy}) translate(-0.5 -0.5)">${markup}</g>`;
}

/**
 * Forgejo/Gitea layout: 3×3 with a center motif, rotating side tiles, then a left-right mirror
 * so the face stays balanced after circular crop (no mid-cross seam from a 2×2 grid).
 */
function renderGrid(b: Uint8Array, fg: string, accent: string): string {
  const sideA = SHAPES[b[3] % SHAPE_COUNT].draw(fg);
  const sideB = SHAPES[b[4] % SHAPE_COUNT].draw(fg);
  const center = CENTER_SHAPES[b[5] % CENTER_COUNT].draw(accent);
  const next = (a: number) => (a + 1) % 4;
  const a0 = b[6] % 4;
  const b0 = b[7] % 4;
  const a1 = next(a0);
  const b1 = next(b0);
  const a2 = next(a1);
  const b2 = next(b1);

  // Left + center columns, then mirror the left column (Forgejo left-right symmetry).
  return [
    placeTile(0, 0, sideA, a0),
    placeTile(1, 0, sideB, b0),
    placeTile(0, 1, sideB, b1),
    placeTile(1, 1, center, 0),
    placeTile(0, 2, sideA, a2),
    placeTile(1, 2, sideB, b2),
    placeTile(2, 0, sideA, a0, true),
    placeTile(2, 1, sideB, b1, true),
    placeTile(2, 2, sideA, a2, true),
  ].join('');
}

/** Circle-safe SVG: padded 3×3 motif on a solid field, ready for `rounded-full` CSS. */
export function identiconSvg(seed: IdenticonSeed, size?: number): string {
  const bytes = sha256Sync(normalizeSeed(seed));
  const pal = ENCRYPT_PALETTES[((bytes[22] << 8) | bytes[23]) % ENCRYPT_PALETTES.length];
  const { bg, fg, accent } = pickColors(pal, bytes);
  const body = renderGrid(bytes, fg, accent);
  const sizeAttrs = size ? ` width="${size}" height="${size}"` : '';
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}"${sizeAttrs} xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>${body}</svg>`;
}

export function identiconDataUri(seed: IdenticonSeed): string {
  return `data:image/svg+xml,${encodeURIComponent(identiconSvg(seed))}`;
}

export function identiconBackground(seed: IdenticonSeed): string {
  // SVG is already circle-safe (padded 3×3). Fill the square element; CSS rounds the crop.
  return `url("${identiconDataUri(seed)}") center / 100% 100% no-repeat`;
}
