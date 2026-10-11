import { handle } from '@astrojs/cloudflare/handler';
import { DurableObject } from 'cloudflare:workers';
import { ChatServer, WhiteboardServer, routeRealtimeRequest, type RealtimeEnv } from '../party/server';
import { localeResponse } from './lib/locale';

export { ChatServer, WhiteboardServer };

type Env = RealtimeEnv & {
  SECURITY_BUDGET: DurableObjectNamespace<SecurityBudget>;
  RATE_LIMIT_SECRET?: string;
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
    const { key, limit, globalLimit } = await request.json() as { key: string; limit: number; globalLimit: number };
    const minute = Math.floor(Date.now() / 60000);
    const { ok, rolled } = await this.ctx.storage.transaction(async txn => {
      const current = await txn.get<number>('minute');
      const rolled = current !== minute;
      if (rolled) { const keys = [...(await txn.list()).keys()]; if (keys.length) await txn.delete(keys); await txn.put('minute', minute); }
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

async function clientKey(env: Env, request: Request): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const data = enc.encode(`${Math.floor(Date.now() / 60000)}:${ip}`);
  const secret = env.RATE_LIMIT_SECRET || env.ROOM_TURN_SECRET;
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    const isApi = path.startsWith('/api/');
    const isRealtime = path.startsWith('/parties/');
    if (isApi || isRealtime) {
      if (crossSite(request)) return new Response('Forbidden', { status: 403 });
      const route = isRealtime ? '/parties' : path.startsWith('/api/drand/') ? '/api/drand' : path;
      const refused = await withinBudget(env, route, request);
      if (refused) return refused;
      if (isRealtime) return (await routeRealtimeRequest(request, env)) ?? new Response('Not found', { status: 404 });
    }
    return localeResponse(request) ?? handle(request, env as any, ctx);
  },
};
