import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

// Files the Cloudflare asset layer reads as configuration and never serves.
const RESERVED = new Set(['/_headers', '/_redirects', '/_routes.json', '/_worker.js', '/.assetsignore']);
const DEFAULT_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
};

export type HeaderRule = { pattern: RegExp; set: [string, string][]; detach: string[] };
export type RedirectRule = { pattern: RegExp; to: string; status: number };
type Asset = { file: string; size: number; etag: string; type: string };

/** `*` is a splat that may cross segments, `:name` one segment; both can be echoed in the target as `:splat` / `:name`. */
function compilePattern(pattern: string): RegExp {
  let source = '';
  let splat = false;
  for (const token of pattern.split(/(\*|:[A-Za-z]\w*)/)) {
    if (token === '*' && !splat) { source += '(?<splat>.*)'; splat = true; }
    else if (token === '*') source += '.*';
    else if (token.startsWith(':')) source += `(?<${token.slice(1)}>[^/]+)`;
    else source += token.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

const fill = (template: string, groups: Record<string, string> = {}) =>
  template.replace(/:([A-Za-z]\w*)/g, (token, name: string) => groups[name] ?? token);

export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = line.startsWith('/') ? { pattern: compilePattern(line), set: [], detach: [] } : null;
      if (current) rules.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('!')) { current.detach.push(line.slice(1).trim().toLowerCase()); continue; }
    const colon = line.indexOf(':');
    if (colon > 0) current.set.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

/** Every matching block applies; a header named again by a later block is joined with a comma, `! Name` removes it. */
export function matchHeaders(rules: HeaderRule[], pathname: string, headers = new Headers()): Headers {
  const custom = new Set<string>();
  for (const rule of rules) {
    const match = rule.pattern.exec(pathname);
    if (!match) continue;
    for (const name of rule.detach) { headers.delete(name); custom.delete(name); }
    for (const [name, template] of rule.set) {
      const value = fill(template, match.groups);
      const key = name.toLowerCase();
      if (custom.has(key)) headers.set(name, `${headers.get(name)}, ${value}`);
      else { headers.set(name, value); custom.add(key); }
    }
  }
  return headers;
}

export function parseRedirects(text: string): RedirectRule[] {
  const rules: RedirectRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [from, to, code] = line.split(/\s+/);
    const status = code ? Number(code) : 302;
    if (!from?.startsWith('/') || !to || !REDIRECT_STATUSES.has(status)) continue;
    rules.push({ pattern: compilePattern(from), to, status });
  }
  return rules;
}

export function matchRedirect(rules: RedirectRule[], url: URL): { location: string; status: number } | null {
  for (const rule of rules) {
    const match = rule.pattern.exec(url.pathname);
    if (!match) continue;
    const target = new URL(fill(rule.to, match.groups), url);
    if (!target.search) target.search = url.search;
    return { location: target.origin === url.origin ? target.pathname + target.search + target.hash : target.href, status: rule.status };
  }
  return null;
}

/**
 * Lookup with Cloudflare's default `auto-trailing-slash` HTML handling: `/page` serves `page.html`, `/dir/` serves
 * `dir/index.html`, and the other spellings of either redirect (307) to that canonical one.
 */
export function resolveAsset(has: (file: string) => boolean, pathname: string): { file: string } | { redirect: string } | null {
  if (pathname.endsWith('/index.html')) return has(pathname) ? { redirect: pathname.slice(0, -'index.html'.length) } : null;
  if (pathname.endsWith('.html')) {
    const stem = pathname.slice(0, -'.html'.length);
    if (has(pathname)) return { redirect: stem };
    return has(`${stem}/index.html`) ? { redirect: `${stem}/` } : null;
  }
  if (pathname.endsWith('/')) {
    if (has(`${pathname}index.html`)) return { file: `${pathname}index.html` };
    const stem = pathname.slice(0, -1);
    return stem && has(`${stem}.html`) ? { redirect: stem } : null;
  }
  if (has(pathname)) return { file: pathname };
  if (has(`${pathname}.html`)) return { file: `${pathname}.html` };
  return has(`${pathname}/index.html`) ? { redirect: `${pathname}/` } : null;
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some(tag => tag.trim().replace(/^W\//, '') === etag);
}

function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? 'invalid' : { start, end };
}

async function walk(dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const publicPath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(path.join(dir, entry.name), publicPath));
    else if (entry.isFile()) files.push(publicPath);
  }
  return files;
}

/** The built client directory served like Workers static assets. Only files indexed at startup are ever opened. */
export class StaticSite {
  private constructor(private readonly assets: Map<string, Asset>, readonly headerRules: HeaderRule[], readonly redirectRules: RedirectRule[]) {}

  static async load(dir: string): Promise<StaticSite> {
    const read = (name: string) => readFile(path.join(dir, name), 'utf8').catch(() => '');
    const ignored = new Set((await read('.assetsignore')).split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(name => `/${name.replace(/^\//, '')}`));
    const assets = new Map<string, Asset>();
    for (const publicPath of await walk(dir)) {
      if (RESERVED.has(publicPath) || ignored.has(publicPath)) continue;
      const file = path.join(dir, ...publicPath.split('/'));
      const content = await readFile(file);
      assets.set(publicPath, {
        file,
        size: content.length,
        etag: `"${createHash('sha256').update(content).digest('hex').slice(0, 32)}"`,
        type: MIME[path.extname(publicPath).toLowerCase()] ?? 'application/octet-stream',
      });
    }
    return new StaticSite(assets, parseHeaders(await read('_headers')), parseRedirects(await read('_redirects')));
  }

  /** The file at exactly `publicPath`, for prerendered error pages. */
  read(publicPath: string): Response | null {
    const asset = this.assets.get(publicPath);
    if (!asset) return null;
    return new Response(Readable.toWeb(createReadStream(asset.file)) as ReadableStream<Uint8Array>, { headers: { 'Content-Type': asset.type } });
  }

  /** A redirect or file response, or null when the request belongs to the server-rendered app. */
  serve(request: Request): Response | null {
    const url = new URL(request.url);
    const redirect = matchRedirect(this.redirectRules, url);
    if (redirect) return this.redirect(url.pathname, redirect.location, redirect.status);
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
    const resolved = resolveAsset(file => this.assets.has(file), pathname);
    if (!resolved) return null;
    if ('redirect' in resolved) return this.redirect(url.pathname, encodeURI(resolved.redirect) + url.search, 307);
    const asset = this.assets.get(resolved.file)!;
    const headers = new Headers({ 'Content-Type': asset.type, 'Cache-Control': DEFAULT_CACHE_CONTROL, ETag: asset.etag, 'Accept-Ranges': 'bytes' });
    matchHeaders(this.headerRules, url.pathname, headers);
    if (etagMatches(request.headers.get('If-None-Match'), asset.etag)) {
      headers.delete('Content-Type');
      return new Response(null, { status: 304, headers });
    }
    const ifRange = request.headers.get('If-Range');
    const range = !ifRange || ifRange === asset.etag ? parseRange(request.headers.get('Range'), asset.size) : null;
    if (range === 'invalid') {
      headers.set('Content-Range', `bytes */${asset.size}`);
      return new Response(null, { status: 416, headers });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? asset.size - 1;
    headers.set('Content-Length', String(asset.size ? end - start + 1 : 0));
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${asset.size}`);
    const body = request.method === 'HEAD' || asset.size === 0 ? null : Readable.toWeb(createReadStream(asset.file, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(body, { status: range ? 206 : 200, headers });
  }

  private redirect(pathname: string, location: string, status: number) {
    const headers = matchHeaders(this.headerRules, pathname, new Headers({ Location: location, 'Cache-Control': DEFAULT_CACHE_CONTROL }));
    return new Response(null, { status, headers });
  }
}
