import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../lib/rateLimit';

const DRAND_ORIGIN = 'https://api.drand.sh';
const DRAND_LIMIT = 120;

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const { ok, remaining, resetIn } = await checkRateLimit('drand', request, DRAND_LIMIT);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(resetIn),
        'X-RateLimit-Remaining': '0'
      }
    });
  }

  const upstream = `${DRAND_ORIGIN}/${params.path ?? ''}`;
  const res = await fetch(upstream, {
    headers: { 'Accept': 'application/json' }
  });

  const headers: Record<string, string> = {
    'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
    'Cache-Control': res.headers.get('Cache-Control') ?? 'public, max-age=2',
    'X-RateLimit-Remaining': String(remaining - 1)
  };
  return new Response(res.body, { status: res.status, headers });
};
