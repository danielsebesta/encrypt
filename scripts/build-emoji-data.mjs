// Regenerates src/lib/emoji/*.json from Unicode emoji-test.txt and CLDR annotations.
// Usage: node scripts/build-emoji-data.mjs [rawDir]
// Raw downloads are cached in rawDir (default: the system temp directory) so nothing untracked lands in the repo.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = resolve(process.argv[2] ?? join(tmpdir(), 'encrypt-emoji-raw'));
const outDir = join(root, 'src', 'lib', 'emoji');
const locales = ['en', 'cs', 'de', 'es', 'fr', 'sk', 'pl'];

const EMOJI_TEST_URL = 'https://unicode.org/Public/emoji/latest/emoji-test.txt';
const CLDR = 'https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json';
const annotationsUrl = (l) => `${CLDR}/cldr-annotations-full/annotations/${l}/annotations.json`;
const derivedUrl = (l) => `${CLDR}/cldr-annotations-derived-full/annotationsDerived/${l}/annotations.json`;

const GROUPS = {
  'Smileys & Emotion': 'smileys',
  'People & Body': 'people',
  'Animals & Nature': 'animals',
  'Food & Drink': 'food',
  'Travel & Places': 'travel',
  Activities: 'activities',
  Objects: 'objects',
  Symbols: 'symbols',
  Flags: 'flags',
};
const TONES = ['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const TONE_RE = /[\u{1F3FB}-\u{1F3FF}]/u;
const BASELINE_VERSION = 12;
// Search tie-breaker: the most used emoji, roughly in the order of Unicode's published emoji frequency ranking.
const POPULAR = [
  '😂', '❤️', '🤣', '👍', '😭', '🙏', '😘', '🥰', '😍', '😊', '🎉', '😁', '💕', '🥺', '😅', '🔥', '☺️', '🤦', '♥️', '🤷',
  '🙄', '😆', '🤗', '😉', '🎂', '🤔', '👏', '🙂', '😳', '🥳', '😎', '👌', '💜', '😔', '💪', '✨', '💖', '👀', '😋', '😏',
  '😢', '👉', '💗', '😩', '💯', '🌹', '💞', '🎈', '💙', '😃', '😡', '💐', '😜', '🙈', '🤞', '😄', '🤤', '🙌', '🤪', '❣️',
  '😀', '💋', '💀', '👇', '💔', '😌', '💓', '🤩', '🙃', '😬', '😱', '😴', '🤭', '😐', '🌞', '😒', '😇', '🌸', '😈', '🎶',
  '✌️', '🎊', '🥵', '😞', '💚', '☀️', '🖤', '💰', '😚', '👑', '🎁', '💥', '🙋', '☹️', '😑', '🥴', '👈', '💩', '✅', '👋',
];

async function cached(name, url) {
  const file = join(rawDir, name);
  try {
    await access(file);
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${url}`);
  }
  return readFile(file, 'utf8');
}

function applyTone(emoji, tone) {
  const cps = [...emoji];
  if (cps[1] === '\u{FE0F}') cps.splice(1, 1);
  cps.splice(1, 0, tone);
  return cps.join('');
}

function parseEmojiTest(text) {
  const version = /^# Version: ([\d.]+)/m.exec(text)?.[1] ?? '';
  const qualified = new Set();
  const entries = [];
  let group = null;
  for (const line of text.split('\n')) {
    const g = /^# group: (.+)$/.exec(line);
    if (g) {
      group = GROUPS[g[1].trim()] ?? null;
      continue;
    }
    const m = /^([0-9A-F ]+?)\s*; fully-qualified\s+# \S+ E(\d+\.\d+) /.exec(line);
    if (!m) continue;
    const emoji = String.fromCodePoint(...m[1].split(' ').map((h) => parseInt(h, 16)));
    qualified.add(emoji);
    if (!group || TONE_RE.test(emoji)) continue;
    entries.push({ emoji, group, version: m[2] });
  }
  return { version, qualified, entries };
}

const stripVs = (s) => s.replace(/\u{FE0F}/gu, '');
const clean = (s) => s.toLowerCase().replace(/[|\s]+/g, ' ').trim();
const words = (s) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function buildNames(entries, ann, der, fallback) {
  const table = { ...der.annotationsDerived.annotations, ...ann.annotations.annotations };
  const lookup = (emoji) => table[emoji] ?? table[stripVs(emoji)];
  const out = {};
  let missing = 0;
  for (const { emoji } of entries) {
    const a = lookup(emoji);
    const name = a?.tts?.[0] ? clean(a.tts[0]) : '';
    if (!name) {
      missing += 1;
      if (fallback?.[emoji]) out[emoji] = fallback[emoji];
      continue;
    }
    const nameWords = words(name);
    const bag = [...new Set((a.default ?? []).flatMap((kw) => words(clean(kw))))].filter((w) => w.length > 1);
    const keep = bag.filter((w) => ![...nameWords, ...bag].some((other) => other !== w && other.startsWith(w)) && !nameWords.includes(w));
    out[emoji] = keep.length ? `${name}|${keep.join(' ')}` : name;
  }
  return { names: out, missing };
}

await mkdir(rawDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const { version, qualified, entries } = parseEmojiTest(await cached('emoji-test.txt', EMOJI_TEST_URL));

const groups = Object.values(GROUPS).map((id) => ({ id, e: [], t: [], v: {} }));
const byId = new Map(groups.map((g) => [g.id, g]));
const probes = {};
for (const { emoji, group, version: ver } of entries) {
  const g = byId.get(group);
  const index = g.e.length;
  g.e.push(emoji);
  if (TONES.every((tone) => qualified.has(applyTone(emoji, tone)))) g.t.push(index);
  if (parseFloat(ver) >= BASELINE_VERSION) {
    (g.v[ver] ??= []).push(index);
    const single = [...stripVs(emoji)].length === 1;
    if (!probes[ver] || (single && [...stripVs(probes[ver])].length > 1)) probes[ver] = emoji;
  }
}

const known = new Set(entries.map((e) => e.emoji));
const missingPopular = POPULAR.filter((e) => !known.has(e));
if (missingPopular.length) throw new Error(`popular emoji not in dataset: ${missingPopular.join(' ')}`);
const data = { version, probes, popular: POPULAR, groups };
const dataJson = JSON.stringify(data);
await writeFile(join(outDir, 'emoji-data.json'), dataJson + '\n');
console.log(`emoji-data.json: Emoji ${version}, ${entries.length} emoji, ${groups.reduce((n, g) => n + g.t.length, 0)} with skin tones, ${Buffer.byteLength(dataJson)} bytes`);

let english = null;
for (const locale of locales) {
  const ann = JSON.parse(await cached(`${locale}.annotations.json`, annotationsUrl(locale)));
  const der = JSON.parse(await cached(`${locale}.annotationsDerived.json`, derivedUrl(locale)));
  const { names, missing } = buildNames(entries, ann, der, english);
  if (locale === 'en') english = names;
  const json = JSON.stringify(names);
  await writeFile(join(outDir, `names.${locale}.json`), json + '\n');
  console.log(`names.${locale}.json: ${Object.keys(names).length} names, ${missing} missing${locale === 'en' ? '' : ' (English used)'}, ${Buffer.byteLength(json)} bytes`);
}
