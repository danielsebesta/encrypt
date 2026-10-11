import type { APIRoute } from 'astro';
import { fetchSendEncryptedBlob, isSendUrl } from '../../../lib/nologSend';
import { stripEclkMagic } from '../../../lib/ghost/crypto';

export const prerender = false;

import { parseAllowedFetchUrl, fetchAllowedUrl } from '../../../lib/ghost/allowedFetch';
import { readLimited, MAX_TRANSFER_BYTES } from '../../../lib/httpLimits';

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export const GET: APIRoute = async ({ url }) => {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const parsedTarget = parseAllowedFetchUrl(targetUrl);
  if (!parsedTarget) {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    if (isSendUrl(targetUrl)) {
      const data = await fetchSendEncryptedBlob(targetUrl);
      return new Response(bytesToArrayBuffer(data), {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Send-Encrypted': 'true',
          'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="encrypted.bin"',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox"
        }
      });
    }

    const res = await fetchAllowedUrl(parsedTarget, {
      signal: AbortSignal.timeout(30_000),
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

    const contentType = 'application/octet-stream';
    const data = stripEclkMagic(await readLimited(res, MAX_TRANSFER_BYTES + 4));

    return new Response(bytesToArrayBuffer(data), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
          'Content-Disposition': 'attachment; filename="encrypted.bin"',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox"
      }
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Fetch failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
