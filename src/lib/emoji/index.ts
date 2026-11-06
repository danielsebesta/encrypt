export const EMOJI_GROUPS = ['smileys', 'people', 'animals', 'food', 'travel', 'activities', 'objects', 'symbols', 'flags'] as const;
export type EmojiGroupId = (typeof EMOJI_GROUPS)[number];

export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;
export const SKIN_TONES: readonly SkinTone[] = [0, 1, 2, 3, 4, 5];
const TONE_MODIFIERS = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const VS16 = '\u{FE0F}';

export type EmojiEntry = { emoji: string; tones: boolean; version: string };
export type EmojiGroup = { id: EmojiGroupId; entries: EmojiEntry[] };
export type EmojiData = { version: string; probes: Record<string, string>; popular: string[]; groups: EmojiGroup[] };
export type EmojiNames = Record<string, string>;

type RawData = { version: string; probes: Record<string, string>; popular: string[]; groups: { id: string; e: string[]; t: number[]; v: Record<string, number[]> }[] };

const NAME_LOADERS: Record<string, () => Promise<{ default: EmojiNames }>> = {
  en: () => import('./names.en.json'),
  cs: () => import('./names.cs.json'),
  de: () => import('./names.de.json'),
  es: () => import('./names.es.json'),
  fr: () => import('./names.fr.json'),
  sk: () => import('./names.sk.json'),
  pl: () => import('./names.pl.json'),
};

let dataPromise: Promise<EmojiData> | null = null;
const namesPromises = new Map<string, Promise<EmojiNames>>();

export function parseEmojiData(raw: RawData): EmojiData {
  const groups: EmojiGroup[] = [];
  for (const g of raw.groups) {
    if (!(EMOJI_GROUPS as readonly string[]).includes(g.id)) continue;
    const tones = new Set(g.t);
    const versions = new Map<number, string>();
    for (const [version, indices] of Object.entries(g.v)) for (const i of indices) versions.set(i, version);
    groups.push({ id: g.id as EmojiGroupId, entries: g.e.map((emoji, i) => ({ emoji, tones: tones.has(i), version: versions.get(i) ?? '' })) });
  }
  return { version: raw.version, probes: raw.probes, popular: raw.popular ?? [], groups };
}

export function loadEmojiData(): Promise<EmojiData> {
  dataPromise ??= import('./emoji-data.json').then((m) => parseEmojiData(m.default as RawData)).catch((err) => {
    dataPromise = null;
    throw err;
  });
  return dataPromise;
}

export function loadEmojiNames(locale: string): Promise<EmojiNames> {
  const key = locale in NAME_LOADERS ? locale : 'en';
  let promise = namesPromises.get(key);
  if (!promise) {
    promise = NAME_LOADERS[key]().then((m) => m.default).catch((err) => {
      namesPromises.delete(key);
      throw err;
    });
    namesPromises.set(key, promise);
  }
  return promise;
}

export function stripSkinTone(emoji: string): string {
  return emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');
}

/** Puts a single skin-tone modifier after the first code point, the way every single-person RGI sequence does. */
export function applySkinTone(emoji: string, tone: SkinTone): string {
  const base = stripSkinTone(emoji);
  if (!tone) return base === emoji ? emoji : restoreVs(base);
  const cps = [...base];
  if (cps[1] === VS16) cps.splice(1, 1);
  cps.splice(1, 0, TONE_MODIFIERS[tone]);
  return cps.join('');
}

function restoreVs(base: string): string {
  const cps = [...base];
  if (cps.length > 1 && cps[1] === '\u{200D}' && !/\p{Emoji_Presentation}/u.test(cps[0])) cps.splice(1, 0, VS16);
  else if (cps.length === 1 && !/\p{Emoji_Presentation}/u.test(cps[0])) cps.push(VS16);
  return cps.join('');
}

function lookupName(names: EmojiNames | null | undefined, emoji: string): string | undefined {
  if (!names) return undefined;
  const hit = names[emoji] ?? names[applySkinTone(emoji, 0)];
  return hit === undefined ? undefined : hit.split('|', 1)[0];
}

export function emojiName(emoji: string, ...sources: (EmojiNames | null | undefined)[]): string | undefined {
  for (const names of sources) {
    const name = lookupName(names, emoji);
    if (name) return name;
  }
  return undefined;
}

type IndexEntry = { name: string; nameWords: string[]; words: string[] };
const indexCache = new WeakMap<EmojiNames, Map<string, IndexEntry>>();

export const foldText = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const tokenize = (s: string) => foldText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function searchIndex(names: EmojiNames): Map<string, IndexEntry> {
  let index = indexCache.get(names);
  if (!index) {
    index = new Map();
    for (const [emoji, value] of Object.entries(names)) {
      const bar = value.indexOf('|');
      const name = foldText(bar < 0 ? value : value.slice(0, bar));
      index.set(emoji, { name, nameWords: tokenize(name), words: bar < 0 ? [] : tokenize(value.slice(bar + 1)) });
    }
    indexCache.set(names, index);
  }
  return index;
}

/** Builds the search index for a names table ahead of the first keystroke. */
export function prepareSearch(names: EmojiNames): void {
  searchIndex(names);
}

function score(entry: IndexEntry, phrase: string, tokens: string[]): number {
  let total = entry.name === phrase ? 1000 : 0;
  for (const token of tokens) {
    let best = 0;
    for (const word of entry.nameWords) {
      if (word === token) best = Math.max(best, 40);
      else if (word.startsWith(token)) best = Math.max(best, 30);
    }
    if (best < 30) {
      for (const word of entry.words) {
        if (word === token) best = Math.max(best, 25);
        else if (word.startsWith(token)) best = Math.max(best, 18);
      }
    }
    if (!best) return 0;
    total += best;
  }
  const extra = entry.nameWords.filter((w) => !tokens.some((token) => w.startsWith(token))).length;
  return Math.max(1, total - 2 * extra);
}

/**
 * Word-prefix search over names and keywords. Every query word has to start some word of the name or keywords; the
 * first source is the user's language, later ones (English) only add emoji the earlier ones did not match. Results keep
 * the order of `candidates` among equal scores; `popular` (most used first) nudges common emoji up.
 */
export function searchEmoji(
  query: string,
  candidates: readonly string[],
  sources: (EmojiNames | null | undefined)[],
  limit = 120,
  popular: readonly string[] = [],
): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (isEmoji(trimmed)) return [trimmed];
  const tokens = tokenize(trimmed);
  if (!tokens.length) return [];
  const phrase = tokens.join(' ');
  const boost = new Map(popular.map((emoji, rank) => [emoji, 25 * (1 - rank / popular.length)]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const names of sources) {
    if (!names || out.length >= limit) continue;
    const index = searchIndex(names);
    const hits: { emoji: string; score: number; order: number }[] = [];
    candidates.forEach((emoji, order) => {
      if (seen.has(emoji)) return;
      const entry = index.get(emoji);
      const s = entry ? score(entry, phrase, tokens) : 0;
      if (s > 0) hits.push({ emoji, score: s + (boost.get(emoji) ?? 0), order });
    });
    hits.sort((a, b) => b.score - a.score || a.order - b.order);
    for (const hit of hits) {
      if (out.length >= limit) break;
      seen.add(hit.emoji);
      out.push(hit.emoji);
    }
  }
  return out;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const RECENT_KEY = 'encrypt.click:emoji-recent';
export const TONE_KEY = 'encrypt.click:emoji-tone';
export const RECENT_LIMIT = 24;
const RECENT_STORED = 48;
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

type RecentRecord = { e: string; c: number; t: number };

function readRecents(store: KeyValueStore | null): RecentRecord[] {
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is RecentRecord =>
      !!r && typeof r === 'object' && isEmoji(r.e) && Number.isFinite(r.c) && r.c > 0 && Number.isFinite(r.t));
  } catch {
    return [];
  }
}

const frecency = (r: RecentRecord, now: number) => r.c * Math.pow(0.5, Math.max(0, now - r.t) / HALF_LIFE_MS);

function rank(records: RecentRecord[], now: number): RecentRecord[] {
  return [...records].sort((a, b) => frecency(b, now) - frecency(a, now) || b.t - a.t);
}

/** Most used emoji first, with older uses fading over about a week. */
export function getRecentEmoji(store: KeyValueStore | null = defaultStore(), now = Date.now()): string[] {
  return rank(readRecents(store), now).slice(0, RECENT_LIMIT).map((r) => r.e);
}

export function recordEmojiUse(emoji: string, store: KeyValueStore | null = defaultStore(), now = Date.now()): void {
  if (!store || !isEmoji(emoji)) return;
  const records = readRecents(store);
  const hit = records.find((r) => r.e === emoji);
  if (hit) {
    hit.c = Math.min(hit.c + 1, 1000);
    hit.t = now;
  } else {
    records.push({ e: emoji, c: 1, t: now });
  }
  try {
    store.setItem(RECENT_KEY, JSON.stringify(rank(records, now).slice(0, RECENT_STORED)));
  } catch {}
}

export function clearRecentEmoji(store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.removeItem(RECENT_KEY);
  } catch {}
}

export function getSkinTone(store: KeyValueStore | null = defaultStore()): SkinTone {
  try {
    const n = Number(store?.getItem(TONE_KEY));
    return (SKIN_TONES as readonly number[]).includes(n) ? (n as SkinTone) : 0;
  } catch {
    return 0;
  }
}

export function setSkinTone(tone: SkinTone, store: KeyValueStore | null = defaultStore()): void {
  try {
    if (tone) store?.setItem(TONE_KEY, String(tone));
    else store?.removeItem(TONE_KEY);
  } catch {}
}

const MAX_EMOJI_UNITS = 32;

function compile(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

const RGI_RE = compile('^\\p{RGI_Emoji}$', 'v');
const FUTURE_RE = compile('^[\\p{Extended_Pictographic}&&\\p{Cn}]\\u{FE0F}?[\\u{1F3FB}-\\u{1F3FF}]?$', 'v');
const ELEMENT = '(?:[0-9#*]\\u{FE0F}\\u{20E3}'
  + '|\\p{Regional_Indicator}{2}'
  + '|\\u{1F3F4}[\\u{E0061}-\\u{E007A}]{2,6}\\u{E007F}'
  + '|\\p{Emoji_Modifier_Base}\\u{FE0F}?\\p{Emoji_Modifier}'
  + '|\\p{Emoji_Presentation}'
  + '|\\p{Extended_Pictographic}\\u{FE0F})';
const PICTO = '(?:\\p{Emoji_Modifier_Base}\\u{FE0F}?\\p{Emoji_Modifier}|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\u{FE0F}?)';
const GRAMMAR_RE = compile(`^(?:${ELEMENT}|${PICTO}(?:\\u{200D}${PICTO}){1,3})$`, 'u') as RegExp;

/** Structural fallback for engines without the `v` flag: one emoji element or a ZWJ sequence of up to four. */
export function matchesEmojiGrammar(value: string): boolean {
  return value.length <= MAX_EMOJI_UNITS && GRAMMAR_RE.test(value);
}

/**
 * True when `value` is exactly one RGI emoji (incl. skin-tone, ZWJ, flag, keycap and tag sequences) and nothing else.
 * Safe for untrusted network input: synchronous, no dataset needed, capped at 32 UTF-16 code units. Single pictographs
 * the engine does not know yet are accepted so newer emoji from up-to-date senders still pass.
 */
export function isEmoji(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > MAX_EMOJI_UNITS) return false;
  if (RGI_RE) return RGI_RE.test(value) || (FUTURE_RE?.test(value) ?? false);
  return GRAMMAR_RE.test(value);
}

export const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const COUNTRY_FLAG_RE = /^\p{Regional_Indicator}{2}$|^\u{1F3F4}[\u{E0020}-\u{E007F}]+$/u;

export type EmojiSupport = { version: (version: string) => boolean; flags: boolean };
let supportCache: EmojiSupport | null = null;

/** Probes the system emoji font once so the picker can hide emoji that would render as boxes or split sequences. */
export function detectEmojiSupport(probes: Record<string, string>): EmojiSupport {
  if (supportCache) return supportCache;
  const all: EmojiSupport = { version: () => true, flags: true };
  if (typeof document === 'undefined') return all;
  try {
    const size = 20;
    const canvas = document.createElement('canvas');
    canvas.width = size * 3;
    canvas.height = size * 1.5;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return (supportCache = all);
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.textBaseline = 'top';
    const reference = ctx.measureText('\u{1F600}').width;
    const colored = (emoji: string) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      ctx.fillText(emoji, 0, 0);
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > 64 && Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 48) return true;
      }
      return false;
    };
    const renders = (emoji: string) => {
      const width = ctx.measureText(emoji).width;
      return width > 0 && width < reference * 1.35 && colored(emoji);
    };
    if (!reference || !colored('\u{1F600}')) return (supportCache = all);
    const versions = new Map(Object.entries(probes).map(([version, emoji]) => [version, renders(emoji)]));
    supportCache = { version: (version) => !version || versions.get(version) !== false, flags: renders('\u{1F1E8}\u{1F1FF}') };
  } catch {
    supportCache = all;
  }
  return supportCache;
}

export function isCountryFlag(emoji: string): boolean {
  return COUNTRY_FLAG_RE.test(emoji);
}

/** Emoji the current system can draw, per group, keeping Unicode order. */
export function visibleGroups(data: EmojiData, support: EmojiSupport): EmojiGroup[] {
  return data.groups
    .map((g) => ({ id: g.id, entries: g.entries.filter((e) => support.version(e.version) && (support.flags || !isCountryFlag(e.emoji))) }))
    .filter((g) => g.entries.length);
}
