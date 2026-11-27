import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const en = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8')) as Record<string, string>;
const enKeys = Object.keys(en);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(astro|svelte|ts)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((file) => ({ path: relative(SRC, file).split(sep).join('/'), text: readFileSync(file, 'utf8') }));
const sourceText = files.map((f) => f.text).join('\n');

function skipString(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === quote) return i;
  }
  return text.length;
}

function keyArg(text: string, open: number): string {
  const args: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') i = skipString(text, i);
    else if (c === '(') depth++;
    else if (c === ')') {
      if (--depth === 0) {
        args.push(text.slice(from, i));
        break;
      }
    } else if (c === ',' && depth === 1) {
      args.push(text.slice(from, i));
      from = i + 1;
    }
  }
  return args[1] ?? '';
}

type Literal = { value: string; concatPrefix: boolean; concatSuffix: boolean };

function literalsIn(expr: string): Literal[] {
  const out: Literal[] = [];
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c !== "'" && c !== '"' && c !== '`') continue;
    const end = skipString(expr, i);
    const before = expr.slice(0, i);
    const after = expr.slice(end + 1);
    const comparand = /(===|!==|==|!=)\s*$/.test(before) || /^\s*(===|!==|==|!=)/.test(after);
    if (!comparand && depth === 0) {
      out.push({
        value: expr.slice(i + 1, end),
        concatPrefix: /^\s*\+/.test(after),
        concatSuffix: /\+\s*$/.test(before),
      });
    }
    i = end;
  }
  return out;
}

const CALL = /\b(?:tApp|t)\(\s*[A-Za-z_$][\w$]*\s*,/g;
const literalKeys = new Map<string, string>();
const tPrefixes = new Map<string, string>();

for (const file of files) {
  for (const m of file.text.matchAll(CALL)) {
    const open = (m.index ?? 0) + m[0].indexOf('(');
    for (const lit of literalsIn(keyArg(file.text, open))) {
      if (lit.value.includes('${')) {
        const prefix = lit.value.slice(0, lit.value.indexOf('${'));
        if (prefix) tPrefixes.set(prefix, file.path);
      } else if (lit.concatPrefix) {
        if (lit.value) tPrefixes.set(lit.value, file.path);
      } else if (!lit.concatSuffix) {
        literalKeys.set(lit.value, file.path);
      }
    }
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templatePieces = [...sourceText.matchAll(/`([^`\n]*\$\{[^`\n]*)`/g)].map((m) => m[1].split(/\$\{[^}]*\}/));
const toPattern = (pieces: string[]) => new RegExp(`^${pieces.map(escapeRe).join("[^\\s'\"`]+")}$`);
const keyShaped = (pieces: string[]) => pieces.every((piece) => /^[\w.]*$/.test(piece));
const templatePatterns = templatePieces
  .filter((pieces) => keyShaped(pieces) && pieces.join('').includes('.') && pieces.join('').length >= 3)
  .map(toPattern);
const templateFamilies = templatePieces
  .filter((pieces) => /^[a-z][A-Za-z]{2,}(\.[A-Za-z0-9]+)*\.$/.test(pieces[0]) && keyShaped(pieces))
  .map((pieces) => ({ source: pieces.join('${…}'), pattern: toPattern(pieces) }));

function quotedSomewhere(key: string): boolean {
  return sourceText.includes(`'${key}'`) || sourceText.includes(`"${key}"`) || sourceText.includes(`\`${key}\``);
}

test('every literal t()/tApp() key, including ternary branches, exists in en.json', () => {
  const missing = [...literalKeys.keys()]
    .filter((key) => !(key in en))
    .map((key) => `${key} (${literalKeys.get(key)})`)
    .sort();
  assert.deepEqual(missing, [], `keys used in code but absent from en.json:\n  ${missing.join('\n  ')}`);
});

test('every dynamic key family (template or concatenated prefix) matches at least one en.json key', () => {
  for (const [prefix, origin] of tPrefixes) {
    assert.ok(enKeys.some((key) => key.startsWith(prefix)), `prefix "${prefix}" (${origin}) matches no key in en.json`);
  }
  const empty = templateFamilies.filter((family) => !enKeys.some((key) => family.pattern.test(key))).map((family) => family.source);
  assert.deepEqual(empty, [], `template keys that match no en.json key:\n  ${empty.join('\n  ')}`);
});

test('report: en.json keys nothing in src mentions (informative, does not fail)', () => {
  const unused = enKeys.filter((key) => {
    if (literalKeys.has(key)) return false;
    if (templatePatterns.some((pattern) => pattern.test(key))) return false;
    if (key.endsWith('.app') && literalKeys.has(key.slice(0, -4))) return false;
    return !quotedSomewhere(key);
  });
  console.log(`[i18n] en.json keys: ${enKeys.length}, unused in src: ${unused.length}`);
  for (const key of unused) console.log(`[i18n] unused: ${key}`);
});
