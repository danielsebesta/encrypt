import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const [dirArg, filesArg, wordsArg, successorsArg, alphaArg, pairsArg] = process.argv.slice(2);
if (!dirArg) {
  console.error('usage: node scripts/build-chat-table.mjs <corpus dir> [a.jsonl,b.jsonl] [words=3000] [successors=32] [alpha=1] [pairs=2500]');
  process.exit(1);
}

const DIR = path.resolve(dirArg);
const FILES = (filesArg || 'corpus-big.jsonl,haiku-big.jsonl,gemini-big.jsonl,dsu-big.jsonl,haiku10.jsonl').split(',');
const VOCAB = Number(wordsArg ?? 3000);
const N = Number(successorsArg ?? 32);
const ALPHA = Number(alphaArg ?? 1);
const PAIRS = Number(pairsArg ?? 2500);
const MIN_PAIR = 4;
const MIN_COUNT = 5;
const FLOOR = 1 / 256;
const OUT = path.resolve('src/lib/chatTable.json');

const VULGAR = /^(kurv|pic[iouea]|pyc|cur[aáeiu]k|kokot|debil|hovn|sra[tc]|ser[eu]?$|zasra|prdel|chuj|buzer|zmrd|jebn|jebat|mrd|fuck|shit)/;
const SINGLE = new Set(['a', 'i', 'k', 'o', 's', 'u', 'v', 'z']);

const fold = w => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const split = text => text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

const conversations = [];
for (const name of FILES) {
  const file = path.join(DIR, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    const stream = [];
    for (const msg of Array.isArray(row) ? row : row.lines) {
      const tokens = split(msg).map(surface => ({ surface, key: fold(surface) })).filter(t => t.key);
      tokens.forEach((t, i) => stream.push({ ...t, first: i === 0, last: i === tokens.length - 1 }));
    }
    if (stream.length) conversations.push(stream);
  }
}

const count = new Map();
const surfaces = new Map();
for (const stream of conversations) {
  for (const { surface, key } of stream) {
    count.set(key, (count.get(key) ?? 0) + 1);
    let forms = surfaces.get(key);
    if (!forms) surfaces.set(key, (forms = new Map()));
    forms.set(surface, (forms.get(surface) ?? 0) + 1);
  }
}

const keys = [...count.entries()]
  .filter(([key, c]) => c >= MIN_COUNT && key.length <= 16 && (key.length > 1 || SINGLE.has(key)) && !VULGAR.test(key))
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  .slice(0, VOCAB)
  .map(([key]) => key);
const index = new Map(keys.map((key, i) => [key, i]));
const V = keys.length;

function display(key) {
  const forms = [...surfaces.get(key).entries()].sort((a, b) => b[1] - a[1]);
  const total = forms.reduce((s, [, c]) => s + c, 0);
  const accented = forms.filter(([form]) => form !== key);
  const accentedTotal = accented.reduce((s, [, c]) => s + c, 0);
  return accentedTotal >= total * 0.25 ? accented[0][0] : key;
}

const next = Array.from({ length: V + 1 }, () => new Map());
const occ = new Float64Array(V);
const firsts = new Float64Array(V);
const lasts = new Float64Array(V);
const pairsList = [];
const triples = new Map();

for (const stream of conversations) {
  const ids = stream.map(t => index.get(t.key));
  ids.forEach((id, i) => {
    if (id === undefined) return;
    occ[id]++;
    if (stream[i].first) firsts[id]++;
    if (stream[i].last) lasts[id]++;
    if (stream[i].first && (i === 0 || stream[i - 1].last)) next[V].set(id, (next[V].get(id) ?? 0) + 1);
    const b = ids[i + 1];
    const c = ids[i + 2];
    if (b !== undefined && c !== undefined) {
      const key = id * 65536 + b;
      let row = triples.get(key);
      if (!row) triples.set(key, (row = new Map()));
      row.set(c, (row.get(c) ?? 0) + 1);
    }
    if (b !== undefined) {
      next[id].set(b, (next[id].get(b) ?? 0) + 1);
      pairsList.push([id, b, stream[i].last]);
    }
  });
}

const endP = Float64Array.from(occ, (o, i) => (o ? lasts[i] / o : 0));
const startP = Float64Array.from(occ, (o, i) => (o ? firsts[i] / o : 0));
let rawSum = 0;
let boundaries = 0;
for (const [a, b, boundary] of pairsList) {
  rawSum += Math.sqrt(endP[a] * startP[b]);
  if (boundary) boundaries++;
}
const breakScale = boundaries / rawSum;

function lengths(weights) {
  const nodes = weights.map((w, i) => ({ w, leaves: [i] }));
  const depth = new Array(weights.length).fill(0);
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.w - b.w || a.leaves[0] - b.leaves[0]);
    const a = nodes.shift();
    const b = nodes.shift();
    for (const leaf of [...a.leaves, ...b.leaves]) depth[leaf]++;
    nodes.push({ w: a.w + b.w, leaves: [...a.leaves, ...b.leaves] });
  }
  return depth;
}

const pairList = [...triples.entries()]
  .map(([key, row]) => ({ key, row, total: [...row.values()].reduce((x, y) => x + y, 0) }))
  .filter(p => p.total >= MIN_PAIR)
  .sort((x, y) => y.total - x.total || x.key - y.key)
  .slice(0, PAIRS);
const P = pairList.length;
const coveredTriples = pairList.reduce((s, p) => s + p.total, 0);
const allTriples = [...triples.values()].reduce((s, row) => s + [...row.values()].reduce((x, y) => x + y, 0), 0);

const rows = new Uint16Array((V + 1 + P) * N);
const lens = new Uint8Array((V + 1 + P) * N);
let maxLen = 0;
let weightedBits = 0;
let weightedTotal = 0;

function build(r, counts, fallback) {
  const picked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, N);
  const ids = picked.map(([id]) => id);
  const weights = picked.map(([, c]) => Math.pow(c, ALPHA));
  for (const id of fallback) {
    if (ids.length >= N) break;
    if (ids.includes(id)) continue;
    ids.push(id);
    weights.push(0);
  }
  for (let id = 0; ids.length < N; id++) {
    if (ids.includes(id)) continue;
    ids.push(id);
    weights.push(0);
  }
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const final = weights.map(w => Math.max(w, total * FLOOR));
  const depth = lengths(final);
  rows.set(ids, r * N);
  lens.set(depth, r * N);
  maxLen = Math.max(maxLen, ...depth);
  const sum = final.reduce((a, b) => a + b, 0);
  return depth.reduce((s, d, i) => s + d * (final[i] / sum), 0);
}

for (let r = 0; r <= V; r++) {
  const avg = build(r, next[r], []);
  const freq = r < V ? occ[r] : 0;
  weightedBits += avg * freq;
  weightedTotal += freq;
}

const pairs = new Uint16Array(P * 2);
pairList.forEach((p, j) => {
  const a = Math.floor(p.key / 65536);
  const b = p.key % 65536;
  pairs.set([a, b], j * 2);
  const backoff = [...next[b].entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).map(([id]) => id);
  const avg = build(V + 1 + j, p.row, backoff);
  weightedBits += avg * p.total;
  weightedTotal += p.total;
});

const quantize = values => Uint8Array.from(values, v => Math.min(255, Math.round(v * 255)));
const b64 = typed => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

const table = {
  n: N,
  words: keys.map(display),
  pairs: b64(pairs),
  rows: b64(rows),
  lens: b64(lens),
  endP: b64(quantize(endP)),
  startP: b64(quantize(startP)),
  breakScale: Number(breakScale.toFixed(4)),
};

writeFileSync(OUT, JSON.stringify(table));
console.log(`${conversations.length} conversations, ${V} words, ${N} successors, alpha ${ALPHA}`);
console.log(`${P} word pairs cover ${(100 * coveredTriples / allTriples).toFixed(1)}% of trigrams`);
console.log(`avg ${(weightedBits / weightedTotal).toFixed(2)} bits/word, max code length ${maxLen}, break scale ${breakScale.toFixed(3)}`);
console.log(`-> ${OUT} (${(JSON.stringify(table).length / 1024).toFixed(0)} KB)`);
