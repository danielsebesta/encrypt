import type { Platform } from '../platform/types';
import type { UploadStatus } from './budget';
import { UPLOAD_SCOPE, uploadLimits } from './upload';

const enc = new TextEncoder();
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const value = (env: Platform['env'], name: string) => env[name]?.trim() ?? '';

/** TURN providers /api/turn can hand out credentials for, by the same settings it reads. */
export function turnProviders(env: Platform['env']): string[] {
  const provider = value(env, 'TURN_PROVIDER').toLowerCase();
  const auto = !provider || provider === 'auto';
  const providers: string[] = [];
  if ((auto || provider === 'cloudflare')
    && (value(env, 'CLOUDFLARE_TURN_TOKEN_ID') || value(env, 'CLOUDFLARE_TURN_KEY_ID')) && value(env, 'CLOUDFLARE_TURN_API_TOKEN')) {
    providers.push('cloudflare');
  }
  const secret = ['TURN_AUTH_SECRET', 'COTURN_AUTH_SECRET', 'COTURN_SECRET', 'TURN_SECRET', 'AUTH_SECRET'].some(name => value(env, name));
  const urls = value(env, 'TURN_URLS').split(',').some(url => /^turns?:/.test(url.trim())) || value(env, 'TURN_HOST');
  if ((auto || provider === 'encrypt-1' || provider === 'coturn') && secret && urls) providers.push('coturn');
  return providers;
}

async function sameToken(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([given, expected].map(async text => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * GET /status: aggregates for operators, never anything about a single client. Public unless STATUS_TOKEN is set,
 * then only with `Authorization: Bearer <token>`.
 */
export async function handleStatus(request: Request, platform: Platform): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  }
  const token = value(platform.env, 'STATUS_TOKEN');
  if (token) {
    const given = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
    if (!(await sameToken(given, token))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' } });
    }
  }
  const limits = uploadLimits(platform.env);
  let uploads: UploadStatus | null = null;
  try {
    uploads = await platform.budget<UploadStatus>(UPLOAD_SCOPE, { op: 'status', limits });
  } catch {
    uploads = null;
  }
  const providers = turnProviders(platform.env);
  const body = {
    status: uploads ? 'ok' : 'degraded',
    build: platform.build || value(platform.env, 'BUILD_COMMIT_SHA') || null,
    uptimeSeconds: platform.startedAt ? Math.floor((Date.now() - platform.startedAt) / 1000) : null,
    turn: { configured: providers.length > 0 && Boolean(value(platform.env, 'ROOM_TURN_SECRET')), providers },
    uploads: uploads && {
      available: uploads.available,
      today: uploads.today,
      month: uploads.month,
      limits: {
        dailyBytes: limits.dailyBytes,
        monthlyBytes: limits.monthlyBytes,
        monthlyUploads: limits.monthlyUploads,
        clientDailyBytes: limits.dailyBytesPerClient,
        maxFileBytes: limits.maxFileBytes,
      },
    },
  };
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { headers });
}
