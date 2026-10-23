import type { APIRoute } from 'astro';
import { fetchSendEncryptedBlob, isBareSendUrl, isSendUrl, SEND_AUTH_KEY_HEADER, validSendAuthKey } from '../../../lib/nologSend';
import { ECLK_MAGIC, stripEclkMagic } from '../../../lib/ghost/crypto';

export const prerender = false;

import { parseAllowedFetchUrl, fetchAllowedUrl } from '../../../lib/ghost/allowedFetch';
import { MAX_FIRST_PARTY_BYTES } from '../../../lib/httpLimits';

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// Streams the body through without buffering it, dropping the leading magic bytes and enforcing the size limit.
function stripMagicLimited(body: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let head: Uint8Array | null = new Uint8Array(0);
  let size = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.length;
      if (size > limit) throw new Error('Body too large');
      if (!head) return controller.enqueue(chunk);
      const joined = new Uint8Array(head.length + chunk.length);
      joined.set(head);
      joined.set(chunk, head.length);
      if (joined.length < ECLK_MAGIC.length) { head = joined; return; }
      head = null;
      controller.enqueue(stripEclkMagic(joined));
    },
    flush(controller) {
      if (head?.length) controller.enqueue(head);
    },
  }));
}

export const GET: APIRoute = async ({ url, request }) => {
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

  const authKey = request.headers.get(SEND_AUTH_KEY_HEADER);
  const sendAuth = validSendAuthKey(authKey) && isBareSendUrl(targetUrl);

  try {
    if (sendAuth || isSendUrl(targetUrl)) {
      const data = await fetchSendEncryptedBlob(targetUrl, undefined, sendAuth ? authKey! : undefined);
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

    const controller = new AbortController();
    const headersTimer = setTimeout(() => controller.abort(), 30_000);
    const res = await fetchAllowedUrl(parsedTarget, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }).finally(() => clearTimeout(headersTimer));

    const declared = Number(res.headers.get('content-length'));
    if (!res.ok || !res.body || declared > MAX_FIRST_PARTY_BYTES) {
      await res.body?.cancel();
      return new Response(JSON.stringify({ error: `HTTP ${res.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(stripMagicLimited(res.body, MAX_FIRST_PARTY_BYTES), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
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
