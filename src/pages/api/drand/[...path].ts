import type { APIRoute } from 'astro';
import { fetchNoRedirect } from '../../../lib/httpLimits';

const DRAND_ORIGIN = 'https://api.drand.sh';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  if (!/^(?:[a-f0-9]{64}\/)?(?:info|public\/(?:latest|[1-9][0-9]{0,15}))$/.test(params.path ?? '')) return new Response('Invalid drand path', { status: 400 });
  const upstream = `${DRAND_ORIGIN}/${params.path ?? ''}`;
  const res = await fetchNoRedirect(upstream, {
    headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000)
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': res.headers.get('Cache-Control') ?? 'public, max-age=2',
  };
  return new Response(res.body, { status: res.status, headers });
};
