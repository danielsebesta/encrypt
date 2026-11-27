import { localeInPath, localeResponse, localizedRequest, varyByLanguage } from '../lib/locale';
import { MAX_TRANSFER_BYTES, clientPrefix, routingPath } from '../lib/httpLimits';
import { applySiteBrand } from '../lib/siteBrand';
import { PASS_HEADER, RELAY_DAILY_BYTES_PER_CLIENT, browserFetch, verifyPass, type Charge } from '../lib/uploadPass';
import type { Platform } from '../platform/types';
import { handleStatus } from './status';
import { challengeResponse, challengeSecret, handleUploadRoute } from './upload';

const LIMITS: Record<string, [number, number]> = {
  '/api/ghost/upload': [10, 60], '/api/ghost/fetch': [30, 120],
  '/api/turn': [12, 120], '/api/shorten': [20, 120], '/api/drand': [120, 1200], '/parties': [60, 600],
  '/upload': [20, 120], '/upload/status': [30, 1200], '/upload/challenge': [10, 600], '/upload/pass': [10, 600],
  '/dl': [120, 1_000_000], '/status': [30, 600],
};

const SHARE_TARGET = /^\/share-target\/?$/i;
const enc = new TextEncoder();
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');

// Browsers mark cross-site requests; other sites cannot drive visitors' browsers through these relays.
function crossSite(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin !== new URL(request.url).origin);
}

function ensureHtmlCharset(response: Response): Response {
  const type = response.headers.get('Content-Type') ?? '';
  if (!type.includes('text/html') || /charset=/i.test(type)) return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const BASELINE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

// Routes that never reach Astro skip its middleware and the static _headers file, so they get the baseline here.
// Headers the response already set win; the body stream is passed through untouched.
function hardened(response: Response): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) if (!headers.has(name)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function routeOf(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.startsWith('/parties/')) return '/parties';
  if (lower.startsWith('/dl/')) return '/dl';
  if (lower === '/status') return path === '/status' ? '/status' : '';
  if (lower.startsWith('/api/drand/')) return path.startsWith('/api/drand/') ? '/api/drand' : '';
  if (lower === '/upload' || lower.startsWith('/upload/')) {
    if (lower === '/upload/status') return '/upload/status';
    if (lower === '/upload/challenge') return '/upload/challenge';
    if (lower === '/upload/pass') return '/upload/pass';
    return '/upload';
  }
  if (lower.startsWith('/api/')) return path;
  return null;
}

export function createApp(platform: Platform) {
  const env = platform.env;

  async function clientKey(request: Request, scope: string): Promise<string> {
    const data = enc.encode(`${scope}:${clientPrefix(platform.clientIp(request) || 'local')}`);
    // A dedicated pepper, or one derived from the grant secret under its own label so the two HMAC uses never share a key.
    const secret = env.RATE_LIMIT_SECRET || (env.ROOM_TURN_SECRET ? `rate-limit:${env.ROOM_TURN_SECRET}` : '');
    if (!secret) return hex(await crypto.subtle.digest('SHA-256', data));
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, data));
  }

  async function withinBudget(route: string, request: Request): Promise<Response | null> {
    const limit = LIMITS[route];
    if (!limit) return new Response('Not found', { status: 404 });
    try {
      const key = await clientKey(request, String(Math.floor(Date.now() / 60_000)));
      const ok = await platform.budget<boolean>(route, { op: 'rate', key, limit: limit[0], globalLimit: limit[1] });
      if (!ok) return new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
    } catch {
      // Prefer availability when the Durable Object rate gate blips; hard refusals still come from reserve/challenge.
      return null;
    }
    return null;
  }

  async function relayAllowance(request: Request): Promise<Response | null> {
    const bytes = Number(request.headers.get('Content-Length'));
    if (!request.headers.get('Content-Length') || !Number.isSafeInteger(bytes) || bytes <= 0) return new Response('Length required', { status: 411 });
    if (bytes > MAX_TRANSFER_BYTES) return new Response('Payload too large', { status: 413 });
    try {
      const prefix = clientPrefix(platform.clientIp(request) || 'local');
      const pass = await verifyPass(request.headers.get(PASS_HEADER), challengeSecret(env) || undefined, prefix);
      const client = await clientKey(request, `relay:${new Date().toISOString().slice(0, 10)}`);
      const result = await platform.budget<Charge>('/api/ghost/upload:daily', {
        op: 'relay', client, bytes, browser: browserFetch(request.headers, ['same-origin']), pass, dailyCap: RELAY_DAILY_BYTES_PER_CLIENT,
      });
      if (result === 'ok') return null;
      if (result === 'challenge') return challengeResponse(env);
      return Response.json({ error: 'Too many uploads' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((86_400_000 - (Date.now() % 86_400_000)) / 1000)), 'Cache-Control': 'no-store' } });
    } catch { return new Response('Security budget unavailable', { status: 503 }); }
  }

  return {
    async fetch(request: Request, render: (request: Request) => Promise<Response>): Promise<Response> {
      const url = new URL(request.url);
      if (url.hostname.startsWith('www.')) {
        url.hostname = url.hostname.slice(4);
        return new Response(null, {
          status: 301,
          headers: { Location: url.href, 'Cache-Control': 'public, max-age=3600' },
        });
      }
      const path = routingPath(url.pathname);
      if (path === null) return hardened(new Response('Bad request', { status: 400 }));
      if (path === '/healthz') return hardened(Response.json({ status: 'ok' }));
      // The service worker answers the share sheet on the device; if it is not running yet, the body is dropped unread.
      if (SHARE_TARGET.test(path)) return hardened(new Response(null, { status: 303, headers: { Location: new URL('/app?tab=files', request.url).href } }));
      const route = routeOf(path);
      if (route !== null) {
        if (crossSite(request)) return hardened(new Response('Forbidden', { status: 403 }));
        const refused = await withinBudget(route, request);
        if (refused) return hardened(refused);
        if (route === '/parties') return platform.realtime(request);
        if (route === '/status') return hardened(await handleStatus(request, platform));
        if (route === '/api/ghost/upload' && request.method === 'POST') {
          const held = await relayAllowance(request);
          if (held) return hardened(held);
        }
        const handled = await handleUploadRoute(request, path, platform);
        if (handled) return hardened(handled);
      }
      const redirected = localeResponse(request);
      if (redirected) return redirected;
      const localized = localizedRequest(request);
      const response = await render(localized ?? request);
      if (varyByLanguage(request)) {
        const headers = new Headers(response.headers);
        const location = headers.get('Location');
        if (localized && location) {
          const prefix = `/${localeInPath(new URL(localized.url).pathname)}`;
          const target = new URL(location, request.url);
          if (target.origin === new URL(request.url).origin && (target.pathname === prefix || target.pathname.startsWith(`${prefix}/`))) {
            target.pathname = target.pathname.slice(prefix.length) || '/';
            headers.set('Location', target.href);
          }
        }
        headers.set('Vary', 'Accept-Language, Cookie');
        headers.set('Cache-Control', 'private, no-store');
        return ensureHtmlCharset(await applySiteBrand(new Response(response.body, { status: response.status, statusText: response.statusText, headers })));
      }
      return ensureHtmlCharset(await applySiteBrand(response));
    },

    async guardRealtime(request: Request): Promise<Response | null> {
      const path = routingPath(new URL(request.url).pathname);
      if (path === null || routeOf(path) !== '/parties') return new Response('Not found', { status: 404 });
      if (crossSite(request)) return new Response('Forbidden', { status: 403 });
      return withinBudget('/parties', request);
    },
  };
}
