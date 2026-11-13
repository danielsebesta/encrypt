import { readFileSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { parseCoverTable } from '../../src/lib/chatCipher/tableCodec.ts';

const packed = readFileSync('public/chat-cipher/cs/2/table.bin');
const raw = gunzipSync(packed);
const t = parseCoverTable(new Uint8Array(raw));

function rowStats(level: (typeof t.levels)[0], row: number) {
  if (row < 0) return null;
  const a = level.starts[row];
  const b = level.starts[row + 1];
  const shares = Array.from(level.shares.subarray(a, b));
  const words = Array.from(level.words.subarray(a, b));
  return {
    row,
    n: b - a,
    shareSum: shares.reduce((x, y) => x + y, 0),
    top: words
      .map((w, i) => ({ w, share: shares[i], s: t.words[w] }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 12),
  };
}

const levels = t.levels.map((l) => {
  const sizes = Array.from({ length: l.rows }, (_, i) => l.starts[i + 1] - l.starts[i]);
  const rowSums = Array.from({ length: l.rows }, (_, i) => {
    let s = 0;
    for (let e = l.starts[i]; e < l.starts[i + 1]; e++) s += l.shares[e];
    return s;
  });
  const nonzero = rowSums.filter((s) => s > 0);
  return {
    stride: l.stride,
    rows: l.rows,
    entries: l.starts[l.rows],
    avg: +(l.starts[l.rows] / l.rows).toFixed(2),
    sizeMin: Math.min(...sizes),
    sizeMax: Math.max(...sizes),
    nonzeroRows: sizes.filter((s) => s > 0).length,
    shareSumMin: Math.min(...rowSums),
    shareSumMax: Math.max(...rowSums),
    shareSumMedianNonzero: nonzero.length ? nonzero.sort((a, b) => a - b)[Math.floor(nonzero.length / 2)] : null,
    ctxHead: Array.from(l.context.subarray(0, Math.min(l.rows, 8) * l.stride)),
  };
});

const L0 = t.levels[0];
let turn = -1;
let eol = -1;
for (let i = 0; i < L0.rows; i++) {
  if (L0.context[i] === 1) turn = i;
  if (L0.context[i] === 0) eol = i;
}

const uniShares = Array.from(t.unigramShares);
const out = {
  rawBytes: raw.length,
  gzipBytes: packed.length,
  wordCount: t.words.length,
  nonemptyWords: t.words.filter(Boolean).length,
  keep: t.keep,
  levelCount: t.levels.length,
  words0_20: t.words.slice(0, 20),
  levels,
  unigramCount: t.unigramWords.length,
  uniShareSum: uniShares.reduce((a, b) => a + b, 0),
  uniSorted: Array.from(t.unigramWords).every((w, i, a) => i === 0 || a[i - 1] < w),
  uniTop: Array.from(t.unigramWords)
    .map((w, i) => ({ w, share: t.unigramShares[i], s: t.words[w] }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 20),
  turn: rowStats(L0, turn),
  eol: rowStats(L0, eol),
};

writeFileSync('data/_cs_table_probe_ts.json', JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({
  wordCount: out.wordCount,
  keep: out.keep,
  levelCount: out.levelCount,
  levels: out.levels.map(({ stride, rows, entries, avg, sizeMin, sizeMax, nonzeroRows, shareSumMedianNonzero, shareSumMax }) => ({
    stride, rows, entries, avg, sizeMin, sizeMax, nonzeroRows, shareSumMedianNonzero, shareSumMax,
  })),
  unigramCount: out.unigramCount,
  uniShareSum: out.uniShareSum,
  words0_5: out.words0_20.slice(0, 5),
  turnN: out.turn?.n,
  turnShareSum: out.turn?.shareSum,
  turnTop: out.turn?.top.slice(0, 8),
  eolN: out.eol?.n,
  eolShareSum: out.eol?.shareSum,
}, null, 2));
