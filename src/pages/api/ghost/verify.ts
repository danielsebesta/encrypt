import type { APIRoute } from 'astro';

import { parseAllowedFetchUrl, fetchAllowedUrl } from '../../../lib/ghost/allowedFetch';
import { readJsonLimited, mapConcurrent } from '../../../lib/httpLimits';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: { urls?: string[] };
  try {
    body = await readJsonLimited(request);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!body || !Array.isArray(body.urls) || body.urls.length > 8 || body.urls.some(u => typeof u !== 'string' || !parseAllowedFetchUrl(u))) {
    return new Response(JSON.stringify({ error: 'Invalid URLs (maximum 8)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const urls = [...new Set(body.urls)];

  const results = await mapConcurrent(urls, 3, async (url) => {
      try {
        const res = await fetchAllowedUrl(parseAllowedFetchUrl(url)!, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
        return { url, ok: res.ok, status: res.status };
      } catch {
        return { url, ok: false, status: 0 };
      }
    }
  );

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
