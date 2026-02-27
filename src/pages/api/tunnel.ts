import type { APIRoute } from 'astro';
import { ulid } from 'ulid';

// Use main Buzzheavier upload endpoint, which resolves correctly from your network.
const BUZZHEAVIER_UPLOAD_BASE = 'https://w.buzzheavier.com';

export const prerender = false;

export const PUT: APIRoute = async ({ request, url }) => {
  const nameParam = url.searchParams.get('name') || '';
  const safeName =
    nameParam && nameParam.length <= 200
      ? nameParam.replace(/[^a-zA-Z0-9_.-]/g, '_')
      : `${ulid()}.bin`;

  const target = `${BUZZHEAVIER_UPLOAD_BASE}/${encodeURIComponent(safeName)}`;

  try {
    // Simpler non-streaming proxy: buffer into memory then upload.
    // 70 MB limit on the frontend keeps this reasonable.
    const buf = await request.arrayBuffer();
    const upstream = await fetch(target, {
      method: 'PUT',
      body: buf
    });

    const upstreamText = await upstream.text();

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'Upstream upload failed' }), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let publicId = '';
    try {
      const parsed = JSON.parse(upstreamText);
      if (parsed && typeof parsed === 'object') {
        const data = (parsed as any).data;
        if (data && typeof data.id === 'string') publicId = data.id;
      }
    } catch {
      // ignore parse errors; fallback below
    }

    return new Response(
      JSON.stringify({
        id: publicId || safeName,
        name: safeName,
        url: target
      }),
      {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Tunnel request failed', detail: err?.message ?? '' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

