import { TEXT_MODELS } from './textModel';
import type { CoverLang } from './coverTable';

/**
 * Static canonical Huffman over bytes, per cover language. The model ships with the app, so a 46-byte message can
 * compress to ~25 bytes with no table in the payload; every byte keeps a weight of at least 1, so any input encodes.
 * Packed shape: the MSB-first bit stream only, the final partial byte filled with 1-bits. Those padding bits never
 * form a code (the only all-ones codeword is 15 bits and padding is at most 7), so the unpacker stops when it hits
 * them. Longer inputs are left to the deflate branch, which wins there anyway.
 */

const MAX_LEN = 15;
const MAX_PACKED = 0xff;

interface Tables {
  counts: Uint16Array;
  firstCode: Int32Array;
  firstIndex: Int32Array;
  codes: Uint16Array;
  lengths: Uint8Array;
  sorted: Uint8Array;
}

const cache = new Map<CoverLang, Tables>();

/** Huffman depths for the 256 symbols, by the two-queue method over ascending weights. */
function codeLengths(weights: Uint16Array): Uint8Array {
  const symbols = Array.from({ length: 256 }, (_, byte) => ({ byte, weight: weights[byte] > 0 ? weights[byte] : 1, depth: 0 }));
  symbols.sort((a, b) => a.weight - b.weight || a.byte - b.byte);
  const nodes: { weight: number; left: number; right: number }[] = symbols.map(s => ({ weight: s.weight, left: -1, right: -1 }));
  const innerQueue: number[] = [];
  let leafFront = 0;
  let innerFront = 0;
  const take = (): { index: number; weight: number } => {
    const leaf = leafFront < 256 ? nodes[leafFront].weight : Infinity;
    const inner = innerFront < innerQueue.length ? nodes[innerQueue[innerFront]].weight : Infinity;
    if (leaf <= inner) return { index: leafFront++, weight: leaf };
    return { index: innerQueue[innerFront++], weight: inner };
  };
  for (let remaining = 256; remaining > 1; remaining--) {
    const a = take();
    const b = take();
    nodes.push({ weight: a.weight + b.weight, left: a.index, right: b.index });
    innerQueue.push(nodes.length - 1);
  }
  const lengths = new Uint8Array(256);
  const walk = (index: number, depth: number) => {
    const node = nodes[index];
    if (node.left < 0) {
      symbols[index].depth = Math.max(1, depth);
      return;
    }
    walk(node.left, depth + 1);
    walk(node.right, depth + 1);
  };
  walk(nodes.length - 1, 0);
  for (const s of symbols) lengths[s.byte] = s.depth;
  return lengths;
}

/** Deflates the weights until every code fits 15 bits; halving keeps the ratios. */
function lengthsUnderCap(weights: Uint16Array): Uint8Array {
  const capped = Uint16Array.from(weights);
  for (;;) {
    const lengths = codeLengths(capped);
    let worst = 0;
    for (const len of lengths) worst = Math.max(worst, len);
    if (worst <= MAX_LEN) return lengths;
    for (let b = 0; b < 256; b++) capped[b] = Math.max(1, capped[b] >> 1);
  }
}

function tablesFor(lang: CoverLang): Tables {
  const hit = cache.get(lang);
  if (hit) return hit;
  const lengths = lengthsUnderCap(TEXT_MODELS[lang]);
  const counts = new Uint16Array(MAX_LEN + 1);
  for (const len of lengths) counts[len]++;
  const buckets: number[][] = Array.from({ length: MAX_LEN + 1 }, () => []);
  for (let byte = 0; byte < 256; byte++) buckets[lengths[byte]].push(byte);
  const sorted = new Uint8Array(256);
  const firstIndex = new Int32Array(MAX_LEN + 1);
  const firstCode = new Int32Array(MAX_LEN + 1);
  const codes = new Uint16Array(256);
  let at = 0;
  let code = 0;
  for (let len = 1; len <= MAX_LEN; len++) {
    firstCode[len] = code;
    firstIndex[len] = at;
    for (let k = 0; k < buckets[len].length; k++) {
      const byte = buckets[len][k];
      sorted[at++] = byte;
      codes[byte] = code + k;
    }
    code = (code + buckets[len].length) << 1;
  }
  const tables: Tables = { counts, firstCode, firstIndex, codes, lengths, sorted };
  cache.set(lang, tables);
  return tables;
}

export function huffmanPack(data: Uint8Array, lang: CoverLang): Uint8Array | null {
  if (data.length === 0 || data.length > MAX_PACKED) return null;
  const tables = tablesFor(lang);
  const out = new Uint8Array(Math.ceil((data.length * MAX_LEN) / 8));
  let written = 0;
  for (const byte of data) {
    const code = tables.codes[byte];
    for (let bit = tables.lengths[byte] - 1; bit >= 0; bit--) {
      if ((code >> bit) & 1) out[written >> 3] |= 1 << (7 - (written & 7));
      written++;
    }
  }
  // Fill the unused bits of the last byte with 1s so the unpacker can tell payload from padding.
  while (written & 7) {
    out[written >> 3] |= 1 << (7 - (written & 7));
    written++;
  }
  const packed = written >> 3;
  if (packed >= data.length) return null;
  return out.subarray(0, packed);
}

export function huffmanUnpack(payload: Uint8Array, lang: CoverLang): Uint8Array {
  if (payload.length < 1) throw new Error('Sealed content does not decompress');
  const tables = tablesFor(lang);
  const out: number[] = [];
  const lastBit = payload.length * 8;
  let read = 0;
  while (read < lastBit) {
    let code = 0;
    let depth = 0;
    let ones = true;
    for (;;) {
      if (read >= lastBit) {
        // Incomplete trailing code: only the 1-bit pad is allowed here.
        if (ones) return new Uint8Array(out);
        throw new Error('Sealed content does not decompress');
      }
      const bit = (payload[read >> 3] >> (7 - (read & 7))) & 1;
      read++;
      if (!bit) ones = false;
      code = (code << 1) | bit;
      depth++;
      if (depth > MAX_LEN) throw new Error('Sealed content does not decompress');
      const first = tables.firstCode[depth];
      if (code >= first && code - first < tables.counts[depth]) {
        out.push(tables.sorted[tables.firstIndex[depth] + code - first]);
        if (out.length > MAX_PACKED) throw new Error('Sealed content does not decompress');
        break;
      }
    }
  }
  return new Uint8Array(out);
}
