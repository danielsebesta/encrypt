import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../lib/rateLimit';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { ok, resetIn } = await checkRateLimit('ghost-verify', request, 20);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(resetIn) }
    });
  }

  let body: { urls?: string[] };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const urls = body.urls || [];

  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        return { url, ok: res.ok, status: res.status };
      } catch {
        return { url, ok: false, status: 0 };
      }
    })
  );

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
