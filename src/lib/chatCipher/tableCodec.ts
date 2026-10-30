import { cryptoRand, foldWord, typo, type Rand } from '../chatNoise';

/**
 * Cover text from a word table: the ciphertext, read as one long number, is decoded by an arithmetic coder over the
 * probabilities of the next word, so it comes out as a sample of how people write. Integer math only, so both sides
 * always compute the same frequencies.
 */

const EOL = 0;
const TURN = 1;
const TOTAL = 65536;
const MIN_MASS = 16;
const STOP = 655;
const GUARD_WINDOW = 40;
const GUARD_SHIFT = 4;
const SAFETY_WORDS = 8;
const MAX_BYTES = 64 * 1024;
const MAX_EXTRA_WORDS = 40;
const YIELD_EVERY = 4096;

const TOP = 2 ** 32;
const HALF = 2 ** 31;
const QUARTER = 2 ** 30;

const MARKS = /[,.?!…;:\n\r]/;
const QUESTION_STARTS = new Set(['co', 'kdy', 'kde', 'kam', 'kdo', 'jak', 'proc', 'kolik', 'ktery', 'ktera', 'ktere', 'mas', 'muzes', 'jsi', 'jses', 'chces', 'nechces', 'vis', 'nevis', 'budes', 'pujdes', 'prijdes', 'nemas', 'neni']);
const QUESTION_ENDS = new Set(['ne', 'jo', 'co', 'ty', 'vid', 'nebo']);

interface Level {
  stride: number;
  rows: number;
  context: Uint16Array;
  starts: Uint32Array;
  words: Uint16Array;
  shares: Uint16Array;
}

export interface CoverTable {
  words: string[];
  keep: number;
  levels: Level[];
  unigramWords: Uint16Array;
  unigramShares: Uint16Array;
}

export interface CoverCodec {
  chooseWords(data: Uint8Array, rand?: Rand, onProgress?: (done: number, total: number) => void): Promise<number[]>;
  encode(data: Uint8Array, rand?: Rand, onProgress?: (done: number, total: number) => void): Promise<string>;
  decode(text: string, onProgress?: (done: number, total: number) => void): Promise<Uint8Array>;
}

function pair(bytes: Uint8Array, at: number, count: number): Uint16Array {
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = bytes[at + i] | (bytes[at + count + i] << 8);
  return out;
}

export function parseCoverTable(bytes: Uint8Array): CoverTable {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'ECT1') throw new Error('Invalid language pack');
  const keep = view.getUint32(4, true);
  const levelCount = view.getUint32(8, true);
  const wordBytes = view.getUint32(12, true);
  let at = 16;
  const words = new TextDecoder().decode(bytes.subarray(at, at + wordBytes)).split('\n');
  at += wordBytes;
  const lut = pair(bytes, at, 256);
  at += 512;

  const levels: Level[] = [];
  for (let l = 0; l < levelCount; l++) {
    const stride = l + 1;
    const rows = view.getUint32(at, true);
    const entries = view.getUint32(at + 4, true);
    at += 8;
    const context = new Uint16Array(rows * stride);
    for (let k = 0; k < stride; k++) {
      const column = pair(bytes, at, rows);
      at += rows * 2;
      let value = 0;
      for (let i = 0; i < rows; i++) {
        value = k === 0 ? (value + column[i]) & 0xffff : column[i];
        context[i * stride + k] = value;
      }
    }
    const sizes = pair(bytes, at, rows);
    at += rows * 2;
    const starts = new Uint32Array(rows + 1);
    for (let i = 0; i < rows; i++) starts[i + 1] = starts[i] + sizes[i];
    if (starts[rows] !== entries) throw new Error('Invalid language pack');
    const deltas = pair(bytes, at, entries);
    at += entries * 2;
    const levelWords = new Uint16Array(entries);
    for (let i = 0; i < rows; i++) {
      let word = 0;
      for (let e = starts[i]; e < starts[i + 1]; e++) {
        word = (word + deltas[e]) & 0xffff;
        levelWords[e] = word;
      }
    }
    const shares = new Uint16Array(entries);
    for (let e = 0; e < entries; e++) shares[e] = lut[bytes[at + e]];
    at += entries;
    levels.push({ stride, rows, context, starts, words: levelWords, shares });
  }

  const unigrams = view.getUint32(at, true);
  at += 4;
  const unigramWords = pair(bytes, at, unigrams);
  at += unigrams * 2;
  const unigramShares = new Uint16Array(unigrams);
  for (let e = 0; e < unigrams; e++) unigramShares[e] = lut[bytes[at + e]];
  return { words, keep, levels, unigramWords, unigramShares };
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

const allowedDistance = (word: string) => (word.length <= 4 ? 1 : 2);

interface Style {
  diacritics: number;
  typos: number;
  capitals: boolean;
  commas: number;
}

function randomStyle(rand: Rand): Style {
  return {
    diacritics: rand() < 0.45 ? 1 : rand() < 0.5 ? 0 : 0.4 + rand() * 0.5,
    typos: rand() < 0.5 ? 0 : 0.005 + rand() * 0.02,
    capitals: rand() < 0.4,
    commas: 0.35 + rand() * 0.4,
  };
}

const yieldToPage = () => new Promise<void>(resolve => setTimeout(resolve));

export function createCoverCodec(table: CoverTable): CoverCodec {
  const { words, keep, levels, unigramWords, unigramShares } = table;
  const folded = words.map(foldWord);
  const idOf = new Map<string, number>();
  folded.forEach((word, id) => {
    if (word && id > TURN) idOf.set(word, id);
  });
  const safety = [
    EOL,
    ...Array.from(unigramWords, (word, e) => ({ word, share: unigramShares[e] }))
      .sort((a, b) => b.share - a.share || a.word - b.word)
      .slice(0, SAFETY_WORDS)
      .map(item => item.word),
  ];

  const mass = new Float64Array(words.length);
  const seen = new Uint8Array(words.length);
  const touched = new Uint16Array(words.length);

  function findRow(level: Level, history: number[]): number {
    const { stride, context } = level;
    const tail = history.length - stride;
    let lo = 0;
    let hi = level.rows - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      let order = 0;
      for (let k = 0; k < stride && !order; k++) order = context[mid * stride + k] - history[tail + k];
      if (order === 0) return mid;
      if (order < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  /** Blends every context length, longest first, into ascending word ids with integer frequencies summing to 2^16. */
  function distribution(history: number[]): { ids: number[]; cum: Int32Array } {
    let count = 0;
    let weight = TOTAL;
    const add = (word: number, amount: number) => {
      if (!seen[word]) {
        seen[word] = 1;
        touched[count++] = word;
      }
      mass[word] += amount;
    };
    for (let l = levels.length - 1; l >= 0 && weight >= STOP; l--) {
      const level = levels[l];
      if (history.length < level.stride) continue;
      const row = findRow(level, history);
      if (row < 0) continue;
      let used = 0;
      for (let e = level.starts[row]; e < level.starts[row + 1]; e++) {
        const share = Math.floor((level.shares[e] * keep) / TOTAL);
        add(level.words[e], Math.floor((weight * share) / TOTAL));
        used += share;
      }
      weight = Math.floor((weight * Math.max(0, TOTAL - used)) / TOTAL);
    }
    if (weight >= STOP) {
      for (let e = 0; e < unigramWords.length; e++) add(unigramWords[e], Math.floor((weight * unigramShares[e]) / TOTAL));
    }
    const newest = history.length - 1;
    for (let i = Math.max(0, history.length - GUARD_WINDOW); i + 2 < history.length; i++) {
      const next = history[i + 2];
      if (history[i] === history[newest - 1] && history[i + 1] === history[newest] && next !== EOL && mass[next] > 0) {
        mass[next] = Math.floor(mass[next] / (1 << GUARD_SHIFT));
      }
    }
    for (const word of safety) {
      add(word, 0);
      if (mass[word] < MIN_MASS) mass[word] = MIN_MASS;
    }
    if (history[newest] === EOL || history[newest] === TURN) mass[EOL] = 0;

    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      if (mass[touched[i]] >= MIN_MASS) ids.push(touched[i]);
    }
    ids.sort((a, b) => a - b);
    let sum = 0;
    for (const word of ids) sum += mass[word];
    const budget = TOTAL - ids.length;
    const cum = new Int32Array(ids.length + 1);
    for (let i = 0; i < ids.length; i++) cum[i + 1] = cum[i] + 1 + Math.floor((mass[ids[i]] * budget) / sum);
    cum[ids.length] = TOTAL;
    for (let i = 0; i < count; i++) {
      mass[touched[i]] = 0;
      seen[touched[i]] = 0;
    }
    return { ids, cum };
  }

  async function chooseWords(data: Uint8Array, rand: Rand = cryptoRand, onProgress?: (done: number, total: number) => void): Promise<number[]> {
    const total = data.length * 8;
    let bit = 0;
    const next = () => {
      const position = bit++;
      if (position < total) return (data[position >> 3] >> (7 - (position & 7))) & 1;
      return rand() < 0.5 ? 0 : 1;
    };
    let code = 0;
    for (let i = 0; i < 32; i++) code = code * 2 + next();
    let low = 0;
    let high = TOP - 1;
    const history = [TURN];
    let resolved = 0;
    let pending = 0;
    let extra = 0;
    for (;;) {
      if (history.length > 200 + total) throw new Error('Cover text would be too long');
      const before = resolved;
      const { ids, cum } = distribution(history);
      const range = high - low + 1;
      const target = Math.floor(((code - low + 1) * TOTAL - 1) / range);
      let lo = 0;
      let hi = ids.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cum[mid + 1] <= target) lo = mid + 1;
        else hi = mid;
      }
      high = low + Math.floor((range * cum[lo + 1]) / TOTAL) - 1;
      low += Math.floor((range * cum[lo]) / TOTAL);
      history.push(ids[lo]);
      for (;;) {
        if (high < HALF) {
          resolved += 1 + pending;
          pending = 0;
        } else if (low >= HALF) {
          low -= HALF;
          high -= HALF;
          code -= HALF;
          resolved += 1 + pending;
          pending = 0;
        } else if (low >= QUARTER && high < HALF + QUARTER) {
          low -= QUARTER;
          high -= QUARTER;
          code -= QUARTER;
          pending++;
        } else break;
        low *= 2;
        high = high * 2 + 1;
        code = code * 2 + next();
      }
      if (before >= total) {
        // Everything is written: run on with random bits to the end of the sentence, whose line end needs no token.
        if (ids[lo] === EOL) {
          history.pop();
          break;
        }
        if (++extra >= MAX_EXTRA_WORDS) break;
      }
      if (history.length % YIELD_EVERY === 0) {
        onProgress?.(Math.min(resolved, total), total);
        await yieldToPage();
      }
    }
    return history.slice(1);
  }

  /** Index of the word a typed token stands for among the candidates: exact, else the one close spelling. */
  function slotOf(token: string, ids: number[]): number {
    const exact = idOf.get(token);
    if (exact !== undefined) {
      let lo = 0;
      let hi = ids.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (ids[mid] < exact) lo = mid + 1;
        else hi = mid;
      }
      if (ids[lo] === exact) return lo;
    }
    let best = -1;
    let bestDistance = Infinity;
    let tie = false;
    for (let slot = 0; slot < ids.length; slot++) {
      if (ids[slot] <= TURN) continue;
      const candidate = folded[ids[slot]];
      const limit = allowedDistance(candidate);
      const distance = editDistance(token, candidate, limit);
      if (distance > limit) continue;
      if (distance < bestDistance) {
        best = slot;
        bestDistance = distance;
        tie = false;
      } else if (distance === bestDistance) {
        tie = true;
      }
    }
    return tie ? -1 : best;
  }

  function endOfLine(line: number[], style: Style, rand: Rand): string {
    const first = folded[line[0]];
    const last = folded[line[line.length - 1]];
    if ((QUESTION_STARTS.has(first) || QUESTION_ENDS.has(last)) && rand() < 0.7) return '?';
    const roll = rand();
    if (roll < style.commas) return ',';
    if (roll < style.commas + 0.06) return '...';
    if (roll < style.commas + 0.1) return '!';
    return '.';
  }

  /** Spelling never carries data: decoding folds accents and case, and every typo still points at exactly one candidate. */
  function render(tokens: number[], rand: Rand): string {
    const style = randomStyle(rand);
    let out = '';
    let capital = style.capitals;
    let line: number[] = [];
    tokens.forEach((token, index) => {
      if (token === EOL) {
        const mark = endOfLine(line, style, rand);
        out += mark;
        capital = style.capitals && mark !== ',' && mark !== '...';
        line = [];
        return;
      }
      let text = rand() < style.diacritics ? words[token] : folded[token];
      if (rand() < style.typos) {
        const { ids } = distribution([TURN, ...tokens.slice(0, index)]);
        const slot = slotOf(folded[token], ids);
        for (let attempt = 0; attempt < 4; attempt++) {
          const candidate = typo(text, rand);
          if (candidate !== text && foldWord(candidate) && slotOf(foldWord(candidate), ids) === slot) {
            text = candidate;
            break;
          }
        }
      }
      if (capital) text = text[0].toUpperCase() + text.slice(1);
      capital = false;
      out += (out ? ' ' : '') + text;
      line.push(token);
    });
    if (rand() < 0.5) out += endOfLine(line, style, rand);
    return out;
  }

  /** Words and line ends in order; any mark or line break between two words is one line end. */
  function parse(text: string): (string | null)[] {
    const out: (string | null)[] = [];
    for (const [piece] of text.matchAll(/\p{L}+|[^\p{L}]+/gu)) {
      if (/\p{L}/u.test(piece)) out.push(foldWord(piece));
      else if (MARKS.test(piece) && out.length && out[out.length - 1] !== null) out.push(null);
    }
    while (out.length && out[out.length - 1] === null) out.pop();
    return out;
  }

  return {
    chooseWords,

    async encode(data, rand = cryptoRand, onProgress) {
      if (data.length > MAX_BYTES) throw new Error('Message too large');
      return render(await chooseWords(data, rand, onProgress), rand);
    },

    async decode(text, onProgress) {
      const tokens = parse(text);
      if (!tokens.length) throw new Error('No cover tokens');
      const bytes = new Uint8Array(Math.ceil((tokens.length * 20 + 64) / 8));
      let written = 0;
      let pending = 0;
      const emit = (value: number) => {
        if (value) bytes[written >> 3] |= 1 << (7 - (written & 7));
        written++;
        for (; pending > 0; pending--) {
          if (!value) bytes[written >> 3] |= 1 << (7 - (written & 7));
          written++;
        }
      };
      let low = 0;
      let high = TOP - 1;
      const history = [TURN];
      for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        const { ids, cum } = distribution(history);
        const slot = token === null ? (ids[0] === EOL ? 0 : -1) : slotOf(token, ids);
        if (slot < 0) throw new Error('Cover text does not match this language pack');
        const range = high - low + 1;
        high = low + Math.floor((range * cum[slot + 1]) / TOTAL) - 1;
        low += Math.floor((range * cum[slot]) / TOTAL);
        history.push(ids[slot]);
        for (;;) {
          if (high < HALF) emit(0);
          else if (low >= HALF) {
            emit(1);
            low -= HALF;
            high -= HALF;
          } else if (low >= QUARTER && high < HALF + QUARTER) {
            pending++;
            low -= QUARTER;
            high -= QUARTER;
          } else break;
          low *= 2;
          high = high * 2 + 1;
        }
        if ((index + 1) % YIELD_EVERY === 0) {
          onProgress?.(index + 1, tokens.length);
          await yieldToPage();
        }
      }
      return bytes.slice(0, written >> 3);
    },
  };
}
