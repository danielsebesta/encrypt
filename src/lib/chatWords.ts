import { cryptoRand, foldWord, randomStyle, roughen, tokenize, type Rand } from './chatNoise';

export interface ChatTable {
  n: number;
  words: string[];
  pairs: string;
  rows: string;
  lens: string;
  endP: string;
  startP: string;
  breakScale: number;
}

export interface ChatCodecOptions {
  prefix?: Uint8Array;
}

export interface ChatCodec {
  encode(data: Uint8Array, rand?: Rand): string;
  decode(text: string): Uint8Array;
}

interface Plan {
  ids: number[];
  codes: number[];
  lens: number[];
  bySlot: Map<number, number>;
}

const FUNCTION_RANK = 150;
const WINDOW = 24;
const EXTRAS = 4;
const NEAR = 6;
const BASE = 4;
const BOOSTED = 6;
const EXTRA_WEIGHT = 1 << 11;
const KEY = 1 << 22;

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows = [new Array<number>(b.length + 1), new Array<number>(b.length + 1), new Array<number>(b.length + 1)];
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = rows[i % 3];
    const prev = rows[(i + 2) % 3];
    const prev2 = rows[(i + 1) % 3];
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prev2[j - 2] + 1);
      cur[j] = value;
    }
  }
  return rows[a.length % 3][b.length];
}

function maxDistance(word: string): number {
  return word.length <= 4 ? 1 : 2;
}

function writeVarint(out: number[], value: number) {
  while (value >= 0x80) {
    out.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  out.push(value);
}

function huffmanLengths(weights: number[]): number[] {
  const n = weights.length;
  const order = weights.map((_, i) => i).sort((a, b) => weights[a] - weights[b] || a - b);
  const nodeWeight = order.map(i => weights[i]);
  const parent = new Array<number>(2 * n - 1).fill(-1);
  let leaf = 0;
  let inner = n;
  const take = () => (leaf < n && (inner >= nodeWeight.length || nodeWeight[leaf] <= nodeWeight[inner]) ? leaf++ : inner++);
  for (let k = 0; k < n - 1; k++) {
    const a = take();
    const b = take();
    const id = nodeWeight.length;
    nodeWeight.push(nodeWeight[a] + nodeWeight[b]);
    parent[a] = id;
    parent[b] = id;
  }
  const depth = new Array<number>(nodeWeight.length).fill(0);
  for (let id = nodeWeight.length - 2; id >= 0; id--) depth[id] = depth[parent[id]] + 1;
  const out = new Array<number>(n);
  order.forEach((original, position) => {
    out[original] = depth[position];
  });
  return out;
}

function canonical(ids: number[], lens: number[]): Plan {
  const order = lens.map((_, slot) => slot).sort((a, b) => lens[a] - lens[b] || a - b);
  const codes = new Array<number>(lens.length);
  const bySlot = new Map<number, number>();
  let code = 0;
  let last = lens[order[0]];
  order.forEach((slot, i) => {
    if (i > 0) code = (code + 1) << (lens[slot] - last);
    last = lens[slot];
    codes[slot] = code;
    bySlot.set(lens[slot] * KEY + code, slot);
  });
  return { ids, codes, lens, bySlot };
}

export function createChatCodec(table: ChatTable, options: ChatCodecOptions = {}): ChatCodec {
  const N = table.n;
  const V = table.words.length;
  const prefix = options.prefix ?? new Uint8Array(0);
  const folded = table.words.map(foldWord);
  const pairBytes = base64Bytes(table.pairs);
  const pairList = new Uint16Array(pairBytes.buffer, pairBytes.byteOffset, pairBytes.byteLength / 2);
  const pairRows = new Map<number, number>();
  for (let j = 0; j < pairList.length / 2; j++) pairRows.set(pairList[j * 2] * 65536 + pairList[j * 2 + 1], V + 1 + j);
  const rowBytes = base64Bytes(table.rows);
  const rows = new Uint16Array(rowBytes.buffer, rowBytes.byteOffset, rowBytes.byteLength / 2);
  const lens = base64Bytes(table.lens);
  const endP = base64Bytes(table.endP);
  const startP = base64Bytes(table.startP);
  const fixed = new Map<number, Plan>();

  const rowFor = (older: number, prev: number) => (prev < 0 ? V : (older >= 0 ? pairRows.get(older * 65536 + prev) : undefined) ?? prev);

  function plan(row: number, recent: number[], near: number[]): Plan {
    const base = row * N;
    const staticIds = Array.from(rows.subarray(base, base + N));
    const seen = new Set(recent);
    const extras: number[] = [];
    for (let i = recent.length - 1; i >= 0 && extras.length < EXTRAS; i--) {
      if (!near.includes(recent[i]) && !staticIds.includes(recent[i])) extras.push(recent[i]);
    }
    const boosted = staticIds.some(id => seen.has(id) && !near.includes(id));
    if (!extras.length && !boosted) {
      let cached = fixed.get(row);
      if (!cached) {
        cached = canonical(staticIds, Array.from(lens.subarray(base, base + N)));
        fixed.set(row, cached);
      }
      return cached;
    }
    const weights = staticIds.map((id, i) => (1 << (16 - lens[base + i])) * (seen.has(id) && !near.includes(id) ? BOOSTED : BASE));
    extras.forEach(() => weights.push(EXTRA_WEIGHT));
    const ids = staticIds.concat(extras);
    return canonical(ids, huffmanLengths(weights));
  }

  function remember(recent: number[], word: number) {
    if (word < FUNCTION_RANK) return;
    const at = recent.indexOf(word);
    if (at >= 0) recent.splice(at, 1);
    recent.push(word);
    if (recent.length > WINDOW) recent.shift();
  }

  function slotOf(token: string, ids: number[]): number {
    let best = -1;
    let bestDistance = Infinity;
    let tie = false;
    for (let slot = 0; slot < ids.length; slot++) {
      const candidate = folded[ids[slot]];
      if (candidate === token) return slot;
      const distance = editDistance(token, candidate, maxDistance(candidate));
      if (distance < bestDistance) {
        best = slot;
        bestDistance = distance;
        tie = false;
      } else if (distance === bestDistance) {
        tie = true;
      }
    }
    if (best < 0 || tie || bestDistance > maxDistance(folded[ids[best]])) return -1;
    return best;
  }

  function breakChance(left: number, right: number): number {
    return Math.min(1, Math.sqrt((endP[left] / 255) * (startP[right] / 255)) * table.breakScale);
  }

  function encode(data: Uint8Array, rand: Rand = cryptoRand): string {
    const hasPrefix = prefix.length > 0 && prefix.every((byte, i) => data[i] === byte);
    const body = hasPrefix ? data.subarray(prefix.length) : data;
    const header: number[] = [];
    writeVarint(header, body.length * 2 + (hasPrefix ? 1 : 0));
    const bytes = Uint8Array.from([...header, ...body]);
    const total = bytes.length * 8;
    const bit = (position: number) => (position < total ? (bytes[position >> 3] >> (7 - (position & 7))) & 1 : 0);

    const chain: number[] = [];
    const slots: number[] = [];
    const candidates: number[][] = [];
    const recent: number[] = [];
    const near: number[] = [];
    let position = 0;
    let prev = -1;
    let older = -1;
    while (position < total) {
      const step = plan(rowFor(older, prev), recent, near);
      let code = 0;
      let len = 0;
      let slot: number | undefined;
      do {
        code = (code << 1) | bit(position++);
        len++;
        slot = step.bySlot.get(len * KEY + code);
      } while (slot === undefined);
      const word = step.ids[slot];
      slots.push(slot);
      chain.push(word);
      candidates.push(step.ids);
      remember(recent, word);
      near.push(word);
      if (near.length > NEAR) near.shift();
      older = prev;
      prev = word;
    }

    return roughen(
      chain.map(i => table.words[i]),
      rand,
      randomStyle(rand),
      (_original, noisy, index) => {
        const tokens = tokenize(noisy);
        return tokens.length === 1 && slotOf(tokens[0], candidates[index]) === slots[index];
      },
      index => breakChance(chain[index], chain[index + 1]),
    );
  }

  function decode(text: string): Uint8Array {
    const tokens = tokenize(text);
    if (!tokens.length) throw new Error('No words');
    const bits: number[] = [];
    const recent: number[] = [];
    const near: number[] = [];
    let prev = -1;
    let older = -1;
    for (const token of tokens) {
      const step = plan(rowFor(older, prev), recent, near);
      const slot = slotOf(token, step.ids);
      if (slot < 0) throw new Error(`Unknown word: ${token}`);
      for (let i = step.lens[slot] - 1; i >= 0; i--) bits.push((step.codes[slot] >> i) & 1);
      const word = step.ids[slot];
      remember(recent, word);
      near.push(word);
      if (near.length > NEAR) near.shift();
      older = prev;
      prev = word;
    }

    const byteAt = (index: number) => {
      let value = 0;
      for (let i = 0; i < 8; i++) value = (value << 1) | (bits[index * 8 + i] ?? 0);
      return value;
    };
    const available = bits.length >> 3;

    let header = 0;
    let shift = 1;
    let offset = 0;
    for (;; offset++) {
      if (offset >= available || offset > 4) throw new Error('Truncated message');
      const byte = byteAt(offset);
      header += (byte & 0x7f) * shift;
      shift *= 0x80;
      if (!(byte & 0x80)) break;
    }
    offset++;
    const hasPrefix = header % 2 === 1;
    const length = Math.floor(header / 2);
    if (hasPrefix && !prefix.length) throw new Error('Unsupported message');
    if (available - offset < length) throw new Error('Truncated message');
    if (bits.length - (offset + length) * 8 >= 40) throw new Error('Extra words');

    const out = new Uint8Array((hasPrefix ? prefix.length : 0) + length);
    if (hasPrefix) out.set(prefix);
    for (let i = 0; i < length; i++) out[out.length - length + i] = byteAt(offset + i);
    return out;
  }

  return { encode, decode };
}
