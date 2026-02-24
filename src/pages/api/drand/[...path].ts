import type { APIRoute } from 'astro';

const DRAND_ORIGIN = 'https://api.drand.sh';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const upstream = `${DRAND_ORIGIN}/${params.path ?? ''}`;

  const res = await fetch(upstream, {
    headers: { 'Accept': 'application/json' }
  });

  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': res.headers.get('Cache-Control') ?? 'public, max-age=2'
    }
  });
};
