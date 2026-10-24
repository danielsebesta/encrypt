import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIST_DIR = path.resolve('dist/client');
const HEADERS_PATH = path.join(DIST_DIR, '_headers');
const PLACEHOLDER = '__CSP_SCRIPT_HASHES__';
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;

async function walkHtml(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkHtml(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }
  return files;
}

function sha256Hash(body) {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
}

const hashes = new Set();

for (const filePath of await walkHtml(DIST_DIR)) {
  const html = await readFile(filePath, 'utf8');
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    const body = match[2];
    if (!body.trim()) continue;
    hashes.add(sha256Hash(body));
  }
}

const sorted = [...hashes].sort();
if (sorted.length === 0) {
  throw new Error('No inline scripts found to hash for CSP');
}

let headers = await readFile(HEADERS_PATH, 'utf8');
if (!headers.includes(PLACEHOLDER)) {
  throw new Error(`Missing ${PLACEHOLDER} in dist/client/_headers`);
}

headers = headers.replace(PLACEHOLDER, sorted.join(' '));
await writeFile(HEADERS_PATH, headers);

// Server-rendered pages share the layout, so the middleware gets the same list instead of nonce-tagging every <script.
async function walkJs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkJs(fullPath));
    else if (entry.isFile() && /\.m?js$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

let serverFiles = 0;
for (const filePath of await walkJs(path.resolve('dist/server'))) {
  const source = await readFile(filePath, 'utf8');
  if (!source.includes(PLACEHOLDER)) continue;
  await writeFile(filePath, source.replaceAll(PLACEHOLDER, sorted.join(' ')));
  serverFiles++;
}
if (serverFiles === 0) throw new Error(`Missing ${PLACEHOLDER} in the server build`);

console.log(`Injected ${sorted.length} CSP script hashes into dist/client/_headers and ${serverFiles} server file(s)`);
