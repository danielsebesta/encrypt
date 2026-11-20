import { fetchNoRedirect, readJsonLimited } from '../../lib/httpLimits';
import type { APIRoute } from 'astro';
import { envString } from '../../platform/env';
import { shortLinkTtl } from '../../server/shortLink';

export const prerender = false;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// SHORTENER_URL points at workers/shortener (or a service with the same API) and SHORTENER_TOKEN authorizes us there;
// without them links stay long.
async function shortenShrink(api: string, token: string, urlToShorten: string, ttl: number, signal: AbortSignal): Promise<string | null> {
  const res = await fetchNoRedirect(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'encrypt.click/1', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: urlToShorten, ttl }),
    signal
  });
  if (!res.ok) return null;
  try {
    const data = await res.json() as { short_url?: string };
    return typeof data.short_url === 'string' && data.short_url.startsWith(`${new URL(api).origin}/`) ? data.short_url : null;
  } catch { return null; }
}

export const POST: APIRoute = async ({ request }) => {
  const api = envString('SHORTENER_URL');
  const token = envString('SHORTENER_TOKEN');
  if (!api.startsWith('https://') || !token) return json({ error: 'Shortening is not configured' }, 404);
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

  if (parsed.hash || parsed.username || parsed.password) {
    return json({ error: 'Only links without secrets in fragments can be shortened' }, 400);
  }
  if (parsed.origin !== new URL(request.url).origin) {
    return json({ error: 'URL must be on this site' }, 400);
  }
  // Only receive links are shortened, so the short domain cannot wrap arbitrary uploads or pages.
  if (!/^\/u\/?$/.test(parsed.pathname) || !parsed.searchParams.get('p')) {
    return json({ error: 'Only receive links can be shortened' }, 400);
  }
  const ttl = shortLinkTtl(parsed.searchParams.get('p') ?? '');
  if (ttl === null) return json({ error: 'Only receive links can be shortened' }, 400);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let shorturl: string | null;
  try {
    shorturl = await shortenShrink(api, token, targetUrl, ttl, controller.signal);
  } catch {
    shorturl = null;
  }
  clearTimeout(timeout);

  if (!shorturl) return json({ error: 'Shortening failed' }, 503);
  return json({ shorturl }, 200);
};
