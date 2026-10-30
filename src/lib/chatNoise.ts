export type Rand = () => number;

export function cryptoRand(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 0x100000000;
}

export function foldWord(word: string): string {
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

const ROWS = ['qwertzuiop', 'asdfghjkl', 'yxcvbnm'];
const NEIGHBORS: Record<string, string> = {};
ROWS.forEach((row, r) => {
  for (let i = 0; i < row.length; i++) {
    const near = [row[i - 1], row[i + 1], ROWS[r - 1]?.[i], ROWS[r - 1]?.[i + 1], ROWS[r + 1]?.[i - 1], ROWS[r + 1]?.[i]];
    NEIGHBORS[row[i]] = near.filter(Boolean).join('');
  }
});

const SWAPS: Record<string, string> = { y: 'i', i: 'y', s: 'z', z: 's' };

function pick<T>(items: ArrayLike<T>, rand: Rand): T {
  return items[Math.floor(rand() * items.length)];
}

export function typo(word: string, rand: Rand): string {
  if (word.length < 3) return word;
  const i = 1 + Math.floor(rand() * (word.length - 1));
  const kind = rand();
  if (kind < 0.3) {
    const near = NEIGHBORS[word[i]];
    return near ? word.slice(0, i) + pick(near, rand) + word.slice(i + 1) : word;
  }
  if (kind < 0.5 && i < word.length) return word.slice(0, i - 1) + word[i] + word[i - 1] + word.slice(i + 1);
  if (kind < 0.65) return word.slice(0, i) + word[i] + word.slice(i);
  if (kind < 0.8) return word.slice(0, i) + word.slice(i + 1);
  const swap = SWAPS[word[i]];
  return swap ? word.slice(0, i) + swap + word.slice(i + 1) : word;
}
