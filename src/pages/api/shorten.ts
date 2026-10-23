import { readJsonLimited } from '../../lib/httpLimits';
import type { APIRoute } from 'astro';

const SHRINK_API = 'https://l.encrypt.click/api/shorten';

export const prerender = false;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function shortenShrink(urlToShorten: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(SHRINK_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'encrypt.click/1' },
    body: JSON.stringify({ url: urlToShorten }),
    signal
  });
  if (!res.ok) return null;
  try {
    const data = await res.json() as { short_url?: string };
    return typeof data.short_url === 'string' && data.short_url.startsWith('https://l.encrypt.click/') ? data.short_url : null;
  } catch { return null; }
}

export const POST: APIRoute = async ({ request }) => {
  if (request.headers.get('Content-Type')?.includes('application/json') !== true) {
    return json({ error: 'Content-Type must be application/json' }, 400);
  }

  let body: { url?: string };
  try {
    body = await readJsonLimited(request);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const targetUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!targetUrl) return json({ error: 'Missing url' }, 400);

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return json({ error: 'Invalid URL' }, 400);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (parsed.hash || parsed.username || parsed.password || (!isLocal && (parsed.protocol !== 'https:' || parsed.port))) {
    return json({ error: 'Only HTTPS links without secrets in fragments can be shortened' }, 400);
  }
  if (!isLocal && hostname !== 'encrypt.click') {
    return json({ error: 'URL must be on encrypt.click' }, 400);
  }
  // Only receive links are shortened, so the short domain cannot wrap arbitrary uploads or pages.
  if (!/^\/u\/?$/.test(parsed.pathname) || !parsed.searchParams.get('p')) {
    return json({ error: 'Only receive links can be shortened' }, 400);
  }

  const urlToShorten = isLocal ? `https://encrypt.click${parsed.pathname}${parsed.search}` : targetUrl;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let shorturl: string | null;
  try {
    shorturl = await shortenShrink(urlToShorten, controller.signal);
  } catch {
    shorturl = null;
  }
  clearTimeout(timeout);

  if (!shorturl) return json({ error: 'Shortening failed' }, 503);
  return json({ shorturl }, 200);
};
