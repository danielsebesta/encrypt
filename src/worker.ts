import { handle } from '@astrojs/cloudflare/handler';
import { DurableObject } from 'cloudflare:workers';
import { ChatServer, PersistentChatServer, WhiteboardServer, routeRealtimeRequest, type RealtimeEnv } from '../party/server';
import { localeResponse } from './lib/locale';
import { MAX_TRANSFER_BYTES, clientPrefix, routingPath } from './lib/httpLimits';
import { ClientLedger, PASS_HEADER, RELAY_DAILY_BYTES_PER_CLIENT, browserFetch, verifyPass, type Charge, type ChargeRequest } from './lib/uploadPass';

export { ChatServer, PersistentChatServer, WhiteboardServer };

type Env = RealtimeEnv & {
  SECURITY_BUDGET: DurableObjectNamespace<SecurityBudget>;
  RATE_LIMIT_SECRET?: string;
  UPLOAD_PASS_SECRET?: string;
};

// Per-client and global request ceilings per minute, shared across all isolates through one Durable Object per route.
const LIMITS: Record<string, [number, number]> = {
  '/api/ghost/upload': [10, 60], '/api/ghost/fetch': [30, 120], '/api/ghost/verify': [20, 120],
  '/api/turn': [12, 120], '/api/shorten': [20, 120], '/api/drand': [120, 1200], '/parties': [60, 600],
};

const enc = new TextEncoder();
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');

export class SecurityBudget extends DurableObject {
  async fetch(request: Request) {
    const body = await request.json() as { key: string; limit: number; globalLimit: number } | ChargeRequest;
    if ('bytes' in body) return Response.json({ result: new ClientLedger(this.ctx.storage.sql, 'relay', RELAY_DAILY_BYTES_PER_CLIENT).charge({ ...body, now: undefined }) });
    const { key, limit, globalLimit } = body;
    const minute = Math.floor(Date.now() / 60000);
    const { ok, rolled } = await this.ctx.storage.transaction(async txn => {
      const current = await txn.get<number>('minute');
      const rolled = current !== minute;
      // Storage deletes take at most 128 keys per call.
      if (rolled) { const keys = [...(await txn.list()).keys()]; for (let i = 0; i < keys.length; i += 128) await txn.delete(keys.slice(i, i + 128)); await txn.put('minute', minute); }
      const global = (await txn.get<number>('global') || 0) + 1;
      const personal = (await txn.get<number>(key) || 0) + 1;
      if (global > globalLimit || personal > limit) return { ok: false, rolled };
      await txn.put({ global, [key]: personal });
      return { ok: true, rolled };
    });
    if (rolled) await this.ctx.storage.setAlarm(Date.now() + 120000);
    return Response.json({ ok });
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

// Browsers mark cross-site requests; other sites cannot drive visitors' browsers through these relays.
function crossSite(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin !== new URL(request.url).origin);
}

async function clientKey(env: Env, request: Request, scope = String(Math.floor(Date.now() / 60000))): Promise<string> {
  const ip = clientPrefix(request.headers.get('CF-Connecting-IP') || 'local');
  const data = enc.encode(`${scope}:${ip}`);
  // A dedicated pepper, or one derived from the grant secret under its own label so the two HMAC uses never share a key.
  const secret = env.RATE_LIMIT_SECRET || (env.ROOM_TURN_SECRET ? `rate-limit:${env.ROOM_TURN_SECRET}` : '');
  if (!secret) return hex(await crypto.subtle.digest('SHA-256', data));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, data));
}

async function withinBudget(env: Env, route: string, request: Request): Promise<Response | null> {
  const limit = LIMITS[route];
  if (!limit) return new Response('Not found', { status: 404 });
  try {
    const key = await clientKey(env, request);
    const stub = env.SECURITY_BUDGET.get(env.SECURITY_BUDGET.idFromName(route));
    const result = await stub.fetch('https://budget/check', { method: 'POST', body: JSON.stringify({ key, limit: limit[0], globalLimit: limit[1] }) });
    if (!(await result.json() as { ok: boolean }).ok) return new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
  } catch { return new Response('Security budget unavailable', { status: 503 }); }
  return null;
}

// Relayed uploads leave through this Worker, so each /64 gets a daily byte cap and has to pass a challenge once it looks scripted.
async function relayAllowance(env: Env, request: Request): Promise<Response | null> {
  const bytes = Number(request.headers.get('Content-Length'));
  if (!request.headers.get('Content-Length') || !Number.isSafeInteger(bytes) || bytes <= 0) return new Response('Length required', { status: 411 });
  if (bytes > MAX_TRANSFER_BYTES) return new Response('Payload too large', { status: 413 });
  try {
    const ip = clientPrefix(request.headers.get('CF-Connecting-IP') || 'local');
    const pass = await verifyPass(request.headers.get(PASS_HEADER), env.UPLOAD_PASS_SECRET, ip);
    const client = await clientKey(env, request, `relay:${new Date().toISOString().slice(0, 10)}`);
    const stub = env.SECURITY_BUDGET.get(env.SECURITY_BUDGET.idFromName('/api/ghost/upload:daily'));
    const charge: ChargeRequest = { client, bytes, browser: browserFetch(request.headers, ['same-origin']), pass };
    const { result } = await (await stub.fetch('https://budget/charge', { method: 'POST', body: JSON.stringify(charge) })).json() as { result: Charge };
    if (result === 'ok') return null;
    if (result === 'challenge' && env.UPLOAD_PASS_SECRET) return Response.json({ challenge: 'turnstile' }, { status: 428, headers: { 'Cache-Control': 'no-store' } });
    const retryAfter = result === 'client' ? Math.ceil((86_400_000 - (Date.now() % 86_400_000)) / 1000) : 3600;
    return Response.json({ error: 'Too many uploads' }, { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } });
  } catch { return new Response('Security budget unavailable', { status: 503 }); }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = routingPath(new URL(request.url).pathname);
    if (path === null) return new Response('Bad request', { status: 400 });
    const lower = path.toLowerCase();
    const isApi = lower.startsWith('/api/');
    const isRealtime = lower.startsWith('/parties/');
    if (isApi || isRealtime) {
      if (crossSite(request)) return new Response('Forbidden', { status: 403 });
      const route = isRealtime ? '/parties' : path.startsWith('/api/drand/') ? '/api/drand' : path;
      const refused = await withinBudget(env, route, request);
      if (refused) return refused;
      if (route === '/api/ghost/upload' && request.method === 'POST') {
        const held = await relayAllowance(env, request);
        if (held) return held;
      }
      if (isRealtime) return (await routeRealtimeRequest(request, env)) ?? new Response('Not found', { status: 404 });
    }
    return localeResponse(request) ?? handle(request, env as any, ctx);
  },
};
