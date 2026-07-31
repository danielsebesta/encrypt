import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIST_DIR = path.resolve('dist');
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
  throw new Error(`Missing ${PLACEHOLDER} in dist/_headers`);
}

headers = headers.replace(PLACEHOLDER, sorted.join(' '));
await writeFile(HEADERS_PATH, headers);

console.log(`Injected ${sorted.length} CSP script hashes into dist/_headers`);
