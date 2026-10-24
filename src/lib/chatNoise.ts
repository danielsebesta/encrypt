export type Rand = () => number;

export function cryptoRand(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 0x100000000;
}

export function foldWord(word: string): string {
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

export function tokenize(text: string): string[] {
  return text.split(/[^\p{L}]+/u).map(foldWord).filter(Boolean);
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

export interface Style {
  diacritics: number;
  typos: number;
  commas: number;
  stops: number;
  chatty: number;
  maxRun: number;
  lines: boolean;
  capitals: 'sentence' | 'lower';
  trailing: boolean;
}

export function randomStyle(rand: Rand = cryptoRand): Style {
  const diacritics = rand() < 0.35 ? 1 : rand() < 0.4 ? 0 : 0.3 + rand() * 0.5;
  return {
    diacritics,
    typos: rand() < 0.5 ? 0 : 0.008 + rand() * 0.03,
    commas: rand() < 0.3 ? 0 : 0.03 + rand() * 0.1,
    stops: 0.03 + rand() * 0.12,
    chatty: 0.5 + rand(),
    maxRun: 8 + Math.floor(rand() * 8),
    lines: false,
    capitals: rand() < 0.4 ? 'sentence' : 'lower',
    trailing: rand() < 0.5,
  };
}

const FUNCTION_WORDS = new Set(
  'a i u v z s k o na do od po za pro při bez nad pod před mezi se si ten ta to ti ty je jsem jsi jsme jste jsou by bych bys bychom byste že aby když kdyz jestli jestlize protože protoze ale nebo či ani než nez jako tak už uz ještě jeste i také taky však vždyť moc jen jenom tam tady teď ted'.split(' ').map(foldWord),
);
const CLAUSE_STARTS = new Set(['ze', 'aby', 'kdyz', 'jestli', 'protoze', 'ale', 'ktery', 'ktera', 'ktere', 'kde', 'kam', 'jak', 'nez', 'kdyby', 'dokud']);

export type Accept = (original: string, noisy: string, index: number) => boolean;
export type Breaks = (index: number) => number;

export function roughen(words: string[], rand: Rand = cryptoRand, style: Style = randomStyle(rand), accept: Accept = () => true, breaks?: Breaks): string {
  let out = '';
  let start = true;
  let run = 0;
  words.forEach((word, index) => {
    let text = rand() < style.diacritics ? word : foldWord(word);
    if (rand() < style.typos) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const candidate = typo(text, rand);
        if (candidate !== text && accept(word, candidate, index)) {
          text = candidate;
          break;
        }
      }
    }
    const capital = style.capitals === 'sentence' && start;
    if (capital) text = text[0].toUpperCase() + text.slice(1);
    out += (index && !out.endsWith('\n') ? ' ' : '') + text;
    start = false;
    run++;
    const next = words[index + 1];
    if (next === undefined || FUNCTION_WORDS.has(foldWord(word))) return;
    let stop = breaks ? Math.min(1, breaks(index) * style.chatty) : style.stops;
    if (run < 2) stop *= 0.4;
    if (run >= style.maxRun) stop = Math.max(stop, Math.min(1, 0.3 + 0.15 * (run - style.maxRun)));
    if (rand() < stop) {
      run = 0;
      if (style.lines && rand() < 0.7) {
        out += rand() < 0.25 ? pick(['?', '!', '...'], rand) : '';
        out += '\n';
        start = true;
        return;
      }
      const mark = pick(style.capitals === 'sentence' ? ['.', '.', '.', '?', '!', '...'] : ['?', '!', '...'], rand);
      out += mark;
      start = mark !== '...';
    } else if (CLAUSE_STARTS.has(foldWord(next)) && rand() < style.commas * 4) {
      out += ',';
    }
  });
  if (style.trailing && rand() < 0.5) out += pick(['.', '?', '!', '...'], rand);
  return out;
}
