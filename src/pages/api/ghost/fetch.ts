import type { APIRoute } from 'astro';
import { fetchSendEncryptedBlob, isBareSendUrl, SEND_AUTH_KEY_HEADER, validSendAuthKey } from '../../../lib/nologSend';

export const prerender = false;

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function error(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

// Takes a Send download URL without its fragment and the HMAC key Send checks; the content key never reaches this server.
export const GET: APIRoute = async ({ url, request }) => {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) return error('Missing url parameter', 400);
  const authKey = request.headers.get(SEND_AUTH_KEY_HEADER);
  if (!isBareSendUrl(targetUrl) || !validSendAuthKey(authKey)) return error('Invalid URL', 400);

  try {
    const data = await fetchSendEncryptedBlob(targetUrl, undefined, authKey);
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
  } catch {
    return error('Fetch failed', 502);
  }
};
