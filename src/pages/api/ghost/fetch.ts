import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../lib/rateLimit';

export const prerender = false;

export const GET: APIRoute = async ({ url, request }) => {
  const { ok, resetIn } = await checkRateLimit('ghost-fetch', request, 30);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(resetIn) }
    });
  }

  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `HTTP ${res.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
    const data = await res.arrayBuffer();

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Fetch failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
