import type { APIRoute } from 'astro';

const BUZZHEAVIER_PUBLIC_BASE = 'https://buzzheavier.com';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) {
    return new Response('Missing id', { status: 400 });
  }

  const downloadResolver = `${BUZZHEAVIER_PUBLIC_BASE}/${encodeURIComponent(id)}/download`;

  try {
    // Buzzheavier "Direct: Download" uses HTMX and responds with `Hx-Redirect: <direct-url>`.
    const resolverRes = await fetch(downloadResolver, {
      method: 'GET',
      headers: {
        'HX-Request': 'true',
        'HX-Current-URL': `${BUZZHEAVIER_PUBLIC_BASE}/${encodeURIComponent(id)}`,
        'Referer': `${BUZZHEAVIER_PUBLIC_BASE}/${encodeURIComponent(id)}`
      }
    });

    const direct = resolverRes.headers.get('hx-redirect') || resolverRes.headers.get('Hx-Redirect');
    const target = direct || downloadResolver;

    const upstream = await fetch(target, { method: 'GET' });
    if (!upstream.ok || !upstream.body) {
      return new Response('Tunnel download failed', { status: 502 });
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/octet-stream');
    const len = upstream.headers.get('Content-Length');
    if (len) headers.set('Content-Length', len);

    return new Response(upstream.body, {
      status: 200,
      headers
    });
  } catch {
    return new Response('Tunnel download failed', { status: 502 });
  }
};

