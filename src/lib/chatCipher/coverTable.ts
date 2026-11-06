import { createCoverCodec, parseCoverTable, type CoverCodec, type QuestionWords } from './tableCodec';

/** Cover language packs. Changing a table breaks every existing cover in that language: bump the path version. */
export type CoverLang = 'cs' | 'de' | 'en' | 'es' | 'fr' | 'pl' | 'sk';

export const COVER_LANGS: readonly CoverLang[] = ['cs', 'en', 'de', 'es', 'fr', 'sk', 'pl'];

export const COVER_TABLES: Record<CoverLang, { url: string; sha256: string }> = {
  cs: {
    url: '/chat-cipher/cs/2/table.bin',
    sha256: '0f81bf2edb0c726e3ac4df671b515a0177f1a79ee26e02c5f4875add5e31de8a',
  },
  en: {
    url: '/chat-cipher/en/1/table.bin',
    sha256: '1f70c574036e5d0b4b441127e68043647504b193ad795a3c53a4091d1280b5d5',
  },
  de: {
    url: '/chat-cipher/de/1/table.bin',
    sha256: '05ccb44e8f50a8c93b694f520ffaa60b9670f55c2bbaae78d40a551e361be47b',
  },
  es: {
    url: '/chat-cipher/es/1/table.bin',
    sha256: '6a2b97c490049fdfbf3dd4c3d31594d212b83e7c4eb27f3c936e77d3cdaf21ae',
  },
  fr: {
    url: '/chat-cipher/fr/1/table.bin',
    sha256: '0bda29807c2d94486de7ede7d1a7363edac8e4ab4a463b0a0f79ca6b650183fb',
  },
  sk: {
    url: '/chat-cipher/sk/1/table.bin',
    sha256: '6278a5657f7065fd0f8ec49c3600af2078d6fc86c31b4b1213903c106271795c',
  },
  pl: {
    url: '/chat-cipher/pl/1/table.bin',
    sha256: '545634fa917e2eda64b3edd212e44a35a145733545d4a3e2b09295285ab74c3b',
  },
};

const QUESTIONS: Partial<Record<CoverLang, QuestionWords>> = {
  sk: {
    starts: ['co', 'kedy', 'kde', 'kam', 'kto', 'ako', 'preco', 'kolko', 'ktory', 'ktora', 'ktore', 'mas', 'mozes', 'si', 'chces', 'nechces', 'vies', 'nevies', 'budes', 'pojdes', 'prides', 'nemas', 'ci'],
    ends: ['nie', 'hej', 'co', 'alebo', 'ano'],
  },
  en: {
    starts: ['what', 'when', 'where', 'who', 'why', 'how', 'which', 'whose', 'can', 'could', 'would', 'should', 'will', 'did', 'does', 'do', 'is', 'are', 'was', 'were'],
    ends: ['right', 'yeah', 'or', 'huh'],
  },
  de: {
    starts: ['was', 'wann', 'wo', 'wer', 'warum', 'wie', 'welche', 'welcher', 'welches', 'kannst', 'kann', 'hast', 'bist', 'willst', 'kommst'],
    ends: ['oder', 'ne', 'gell', 'nicht'],
  },
  es: {
    starts: ['que', 'cuando', 'donde', 'quien', 'como', 'cual', 'puedes', 'puedo', 'tienes', 'estas', 'vienes', 'vas'],
    ends: ['verdad', 'no', 'vale'],
  },
  fr: {
    starts: ['quoi', 'quand', 'ou', 'qui', 'pourquoi', 'comment', 'quel', 'quelle', 'peux', 'peut', 'est-ce', 'tu', 'vous'],
    ends: ['non', 'hein', 'quoi'],
  },
  pl: {
    starts: ['co', 'kiedy', 'gdzie', 'kto', 'dlaczego', 'czemu', 'jak', 'ktory', 'ktora', 'ktore', 'czy', 'mozesz', 'masz', 'jestes', 'idziesz'],
    ends: ['nie', 'tak', 'prawda'],
  },
};

/** Czech pack aliases kept for older imports and the golden cover fixture. */
export const COVER_TABLE_URL = COVER_TABLES.cs.url;
export const COVER_TABLE_SHA256 = COVER_TABLES.cs.sha256;

const loading = new Map<CoverLang, Promise<CoverCodec>>();

export function isCoverLang(value: string): value is CoverLang {
  return Object.hasOwn(COVER_TABLES, value);
}

/** The site language when the browser also lists it, otherwise the browser's first cover language, otherwise the site language. */
export function preferredCoverLang(pageLang?: string | null, browserLangs: readonly string[] = []): CoverLang {
  const page = pageLang && isCoverLang(pageLang) ? pageLang : null;
  const browser = browserLangs.map(tag => tag.trim().toLowerCase().split('-')[0]).filter(isCoverLang);
  if (page && (!browser.length || browser.includes(page))) return page;
  return browser[0] ?? page ?? 'cs';
}

/** Cover languages ordered by how much of the text each word table spells exactly; tables that cannot load are skipped. */
export async function rankCoverLangs(cover: string, first: CoverLang): Promise<CoverLang[]> {
  const order = [first, ...COVER_LANGS.filter(lang => lang !== first)];
  const scored = await Promise.all(
    order.map(lang =>
      loadCoverCodec(lang).then(
        codec => ({ lang, score: codec.coverage(cover) }),
        () => null,
      ),
    ),
  );
  const ranked = scored
    .filter((item): item is { lang: CoverLang; score: number } => item !== null && item.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  return ranked.map(item => item.lang);
}

async function fetchCodec(lang: CoverLang, cache: RequestCache): Promise<CoverCodec> {
  const pack = COVER_TABLES[lang];
  const res = await fetch(pack.url, { mode: 'same-origin', credentials: 'omit', cache });
  if (!res.ok) throw new Error(`Could not download the word table (${res.status})`);
  const packed = await res.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', packed));
  const hash = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== pack.sha256) throw new Error('Word table checksum mismatch');
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return createCoverCodec(parseCoverTable(new Uint8Array(await new Response(stream).arrayBuffer())), QUESTIONS[lang]);
}

function load(lang: CoverLang, cache: RequestCache): Promise<CoverCodec> {
  const hit = loading.get(lang);
  if (hit) return hit;
  const pending = fetchCodec(lang, cache).catch((error: unknown) => {
    loading.delete(lang);
    throw error;
  });
  loading.set(lang, pending);
  return pending;
}

/** The word table for one cover language, fetched once per tab. */
export function loadCoverCodec(lang: CoverLang = 'cs'): Promise<CoverCodec> {
  return load(lang, 'default');
}

/** Fetches past the HTTP cache, which would otherwise keep serving a damaged copy. */
export function reloadCoverCodec(lang: CoverLang = 'cs'): Promise<CoverCodec> {
  loading.delete(lang);
  return load(lang, 'reload');
}

/** Frees what the earlier neural models left in this browser, up to about 140 MB. */
export async function dropRetiredModels(): Promise<void> {
  if (typeof caches === 'undefined') return;
  for (const name of await caches.keys()) {
    if (name.startsWith('chat-cipher-') || name === 'transformers-cache') await caches.delete(name);
  }
}
