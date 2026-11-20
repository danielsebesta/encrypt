// Short links for encrypt.click receive links. Only encrypt.click's /api/shorten creates them, with SHORTENER_TOKEN;
// each one expires with the share it points to, and opening one is rate limited so the slugs cannot be walked.

export type ShortenerEnv = {
  URLS: Pick<KVNamespace, 'get' | 'put'>;
  LOOKUPS?: Pick<RateLimit, 'limit'>;
  TARGET_ORIGIN: string;
  SHORTENER_TOKEN?: string;
};

const CONSONANTS = 'bcdfghjkmnprstvz';
const VOWELS = 'aeiou';
const SLUG_PAIRS = 4;
export const SLUG_RE = /^(?:[bcdfghjkmnprstvz][aeiou]){4}$/;
export const MIN_TTL_SECONDS = 60;
export const MAX_TTL_SECONDS = 366 * 24 * 60 * 60;
const MAX_BODY_BYTES = 20_000;
const ATTEMPTS = 5;

const HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...HEADERS, 'Content-Type': 'application/json' } });
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** A uniform letter from the alphabet, rejecting the bytes that would favour its first letters. */
function pick(alphabet: string): string {
  const ceiling = 256 - (256 % alphabet.length);
  const byte = new Uint8Array(1);
  do crypto.getRandomValues(byte); while (byte[0] >= ceiling);
  return alphabet[byte[0] % alphabet.length];
}

export function generateSlug(): string {
  let slug = '';
  for (let i = 0; i < SLUG_PAIRS; i++) slug += pick(CONSONANTS) + pick(VOWELS);
  return slug;
}

async function tokenMatches(header: string | null, token: string): Promise<boolean> {
  const given = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(token))]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Only receive links on the target origin: `/u?p=<fragment>` and nothing else. */
export function isReceiveLink(value: string, targetOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.origin !== targetOrigin || url.username || url.password || url.hash) return false;
  if (!/^\/u\/?$/.test(url.pathname)) return false;
  const keys = [...url.searchParams.keys()];
  return keys.length === 1 && keys[0] === 'p' && Boolean(url.searchParams.get('p'));
}

async function shorten(request: Request, env: ShortenerEnv): Promise<Response> {
  if (!env.SHORTENER_TOKEN || !await tokenMatches(request.headers.get('Authorization'), env.SHORTENER_TOKEN)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const declared = Number(request.headers.get('Content-Length'));
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);

  let body: { url?: unknown; ttl?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const url = typeof body?.url === 'string' ? body.url : '';
  if (!isReceiveLink(url, env.TARGET_ORIGIN)) return json({ error: 'Only receive links can be shortened' }, 400);
  const ttl = Number(body.ttl);
  if (!Number.isSafeInteger(ttl)) return json({ error: 'Invalid ttl' }, 400);
  const expirationTtl = Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, ttl));

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const slug = generateSlug();
    if (await env.URLS.get(`s:${slug}`) !== null) continue;
    await env.URLS.put(`s:${slug}`, url, { expirationTtl });
    return json({ short_url: `${new URL(request.url).origin}/${slug}`, expires_in: expirationTtl }, 201);
  }
  return json({ error: 'No free slug' }, 503);
}

async function redirect(request: Request, env: ShortenerEnv, slug: string): Promise<Response> {
  if (env.LOOKUPS) {
    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    const client = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
    const { success } = await env.LOOKUPS.limit({ key: client });
    if (!success) return new Response('Too many requests\n', { status: 429, headers: { ...HEADERS, 'Retry-After': '60' } });
  }
  const target = await env.URLS.get(`s:${slug}`);
  if (!target || !isReceiveLink(target, env.TARGET_ORIGIN)) return text('This short link does not exist or has expired.\n', 404);
  return new Response(null, { status: 302, headers: { ...HEADERS, Location: target } });
}

export default {
  async fetch(request: Request, env: ShortenerEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/shorten') {
      return request.method === 'POST' ? shorten(request, env) : json({ error: 'Method not allowed' }, 405);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return text('Method not allowed\n', 405);
    if (pathname === '/') return new Response(null, { status: 302, headers: { ...HEADERS, Location: env.TARGET_ORIGIN } });
    const slug = pathname.slice(1);
    if (SLUG_RE.test(slug)) return redirect(request, env, slug);
    return text('Not found\n', 404);
  },
};
