import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../lib/rateLimit';
import { fetchSendEncryptedBlob, isSendUrl } from '../../../lib/nologSend';
import { stripEclkMagic } from '../../../lib/ghost/crypto';

export const prerender = false;

const ALLOWED_FETCH_HOSTS = new Set([
  'dl.encrypt.click',
  'qu.ax',
  'x0.at',
  'tmpfile.link',
  'temp.sh',
  'sxcu.net',
  'freeimage.host',
  'catbox.moe',
  'litterbox.catbox.moe',
  'send.skylerszijjarto.com',
  'send.hostnetwork.xyz',
  'send.adminforge.de',
  'send.cyberjake.xyz',
  'send.turingpoint.de',
  'send.codespace.cz',
  'send.mni.li',
  'upload.nolog.cz',
  'send.monks.tools',
  'send.vis.ee',
  'send.aurorabilisim.com',
  'send.artemislena.eu',
  'fileupload.ggc-project.de',
  'send.kokomo.cloud',
  'drop.chapril.org',
  'send.canine.tools',
  'send.aslaets.be',
  'send.blablalinux.be',
  'dropnito.online',
  'send.jeugdhulp.be',
]);

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseAllowedFetchUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (!ALLOWED_FETCH_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function fetchAllowedUrl(target: URL, init: RequestInit, maxRedirects = 3): Promise<Response> {
  let current = target;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;

    const location = res.headers.get('Location');
    if (!location) return res;
    const next = parseAllowedFetchUrl(new URL(location, current).toString());
    if (!next) throw new Error('Blocked redirect');
    current = next;
  }
  throw new Error('Too many redirects');
}

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
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    const res = await fetchAllowedUrl(parsedTarget, {
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
    const data = stripEclkMagic(new Uint8Array(await res.arrayBuffer()));

    return new Response(bytesToArrayBuffer(data), {
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
