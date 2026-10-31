#!/usr/bin/env node
/**
 * Build a memorable passphrase word list from the EFF large wordlist.
 *
 * Filters out closed-class words, brands, common names/places, hard spellings,
 * confusable homophones, and near-duplicates (edit distance ≤ 1, shared prefixes).
 * Prefers words that also appear in the EFF short list or Google 10k English.
 *
 * Sources (download into tmp/ before running):
 *   https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt
 *   https://www.eff.org/files/2016/09/08/eff_short_wordlist_1.txt
 *   https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt
 *
 * EFF lists: Creative Commons Attribution 3.0 United States.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'tmp');

const parseEff = (file) =>
  fs
    .readFileSync(path.join(tmp, file), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/\t/)[1]?.trim().toLowerCase())
    .filter(Boolean);

const large = [...new Set(parseEff('eff_large.txt'))];
const short = new Set(parseEff('eff_short.txt'));
const google = fs
  .readFileSync(path.join(tmp, 'google10k.txt'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((word) => word.trim().toLowerCase())
  .filter(Boolean);
const rank = new Map(google.map((word, index) => [word, index]));

const CLOSED = new Set(
  `a an the and or but if so to of in on at by for from with into onto upon over under
   about after before against among between through during without within as than then
   that this these those there their they them he she it we you my your our his her its
   who whom whose what which when where why how all any both each few many much most
   other some such only own same very just also even ever never always already still yet
   again here now can could may might must shall should will would are was were been
   being have has had do does did done am is be being been while until unless although
   whether since though using`.split(/\s+/),
);

const BLOCK = new Set(
  `ebay yahoo paypal google skype xbox kodak xerox amazon facebook twitter youtube
   instagram microsoft apple android iphone ipod ipad firefox chrome safari html http
   https www com net org login spam cookie browser isbn jesus christ allah bible quran
   nazi porn sexy nude rape damn shit fuck cocaine heroin marijuana cannabis tobacco
   vodka whiskey john mike david james robert paul mark steve chris jason brian kevin
   scott eric jeff mary lisa karen nancy betty donald george kenneth anthony edward
   ronald timothy jeffrey ryan jacob gary nicholas jonathan larry justin brandon
   benjamin frank gregory raymond alexander patrick jack dennis jerry tyler aaron jose
   henry adam douglas nathan zachary kyle noah logan christian andrew matthew joseph
   charles thomas richard barbara susan jessica sarah helen sandra ashley kimberly emily
   deborah rachel carol amanda melissa stephanie rebecca laura sharon cynthia kathleen
   amy angela shirley anna brenda pamela emma nicole heather terry samuel peter carl
   arthur lawrence joe ralph roy eugene louis philip bobby johnny dallas austin wayne
   paris london tokyo berlin moscow rome madrid ohio texas florida chicago boston
   seattle miami atlanta detroit houston phoenix mexico canada china japan india brazil
   spain italy france germany russia poland sweden norway ireland scotland wales egypt
   kenya ghana korea taiwan vietnam cuba haiti peru chile estonia namibia ecuador samoa
   katie colin martin ohio itunes porsche toyota honda nissan ferrari bmw cisco adobe
   oracle nvidia intel sony nokia samsung verizon verizon`.split(/\s+/),
);

const CONFUSABLES = [
  ['their', 'there'],
  ['hear', 'here'],
  ['wear', 'where', 'were'],
  ['peace', 'piece'],
  ['right', 'write'],
  ['sight', 'site'],
  ['steal', 'steel'],
  ['waist', 'waste'],
  ['weak', 'week'],
  ['weather', 'whether'],
  ['which', 'witch'],
  ['wood', 'would'],
  ['brake', 'break'],
  ['affect', 'effect'],
  ['accept', 'except'],
  ['bare', 'bear'],
  ['base', 'bass'],
  ['board', 'bored'],
  ['cell', 'sell'],
  ['cent', 'sent'],
  ['chord', 'cord'],
  ['coarse', 'course'],
  ['dear', 'deer'],
  ['dual', 'duel'],
  ['fair', 'fare'],
  ['feat', 'feet'],
  ['flour', 'flower'],
  ['great', 'grate'],
  ['hair', 'hare'],
  ['hall', 'haul'],
  ['heal', 'heel'],
  ['hole', 'whole'],
  ['idle', 'idol'],
  ['knight', 'night'],
  ['loan', 'lone'],
  ['mail', 'male'],
  ['main', 'mane'],
  ['meat', 'meet'],
  ['miner', 'minor'],
  ['pail', 'pale'],
  ['pain', 'pane'],
  ['pair', 'pear'],
  ['passed', 'past'],
  ['peak', 'peek'],
  ['plain', 'plane'],
  ['pole', 'poll'],
  ['poor', 'pour'],
  ['pray', 'prey'],
  ['rain', 'reign'],
  ['real', 'reel'],
  ['road', 'rode'],
  ['role', 'roll'],
  ['root', 'route'],
  ['sail', 'sale'],
  ['scene', 'seen'],
  ['seam', 'seem'],
  ['soar', 'sore'],
  ['sole', 'soul'],
  ['some', 'sum'],
  ['son', 'sun'],
  ['stair', 'stare'],
  ['stake', 'steak'],
  ['suite', 'sweet'],
  ['tail', 'tale'],
  ['tide', 'tied'],
  ['vain', 'vein'],
  ['vary', 'very'],
  ['wait', 'weight'],
  ['warn', 'worn'],
  ['whine', 'wine'],
];

function hardSpelling(word) {
  // Prefer longer everyday words: short stubs are easy to mis-hear when dictating.
  if (!/^[a-z]{5,9}$/.test(word)) return true;
  if (/(.)\1\1/.test(word)) return true;
  if (/eous$|ious$|ough$|augh$|eau/.test(word)) return true;
  if (/phth|tsch/.test(word)) return true;
  if (((word.match(/[jqxz]/g) || []).length >= 2)) return true;
  return false;
}

function nearDuplicate(a, b) {
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 2) {
    return true;
  }
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let distance = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++distance > 1) return false;
    }
    return true;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let distance = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
    } else if (++distance > 1) {
      return false;
    } else {
      j++;
    }
  }
  return true;
}

let pool = large.filter((word) => !hardSpelling(word) && !CLOSED.has(word) && !BLOCK.has(word));
pool.sort((a, b) => {
  const shortBoost = (word) => (short.has(word) ? -4000 : 0);
  const common = (word) => (rank.has(word) ? rank.get(word) : 20_000);
  return shortBoost(a) + common(a) - (shortBoost(b) + common(b)) || a.localeCompare(b);
});

const banned = new Set();
for (const group of CONFUSABLES) {
  const present = group.filter((word) => pool.includes(word));
  for (const word of present.slice(1)) banned.add(word);
}
pool = pool.filter((word) => !banned.has(word));

// Everyday words only: EFF short or Google top ~9k.
pool = pool.filter((word) => short.has(word) || (rank.has(word) && rank.get(word) < 9000));

const kept = [];
for (const word of pool) {
  if (kept.some((other) => nearDuplicate(word, other))) continue;
  kept.push(word);
}

if (kept.length < 768) {
  console.error(`Word list too small after filtering: ${kept.length}`);
  process.exit(1);
}

const words = kept.slice(0, 2048);
const out = path.join(root, 'src/lib/passphraseWords.ts');
const body = `// Generated by scripts/build-passphrase-words.mjs from the EFF large wordlist
// (CC BY 3.0 US), filtered for everyday spelling and near-duplicates. Do not edit by hand.
export const PASSPHRASE_WORDS = ${JSON.stringify(words)} as const;
`;
fs.writeFileSync(out, body);
const bits = (n) => Math.log2(words.length) * n + Math.log2(90) + Math.log2(n);
console.log(`Wrote ${words.length} words to ${path.relative(root, out)}`);
console.log(`Entropy with 5 words+trailing digit ≈ ${bits(5).toFixed(1)} bits; 6 ≈ ${bits(6).toFixed(1)} bits`);
console.log(`Sample: ${words.slice(0, 24).join(', ')}`);
