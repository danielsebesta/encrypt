import { env as workerEnv } from 'cloudflare:workers';
import { verifyTurnGrant } from '../../lib/turnGrant';
import type { APIRoute } from 'astro';
import { fetchNoRedirect } from '../../lib/httpLimits';

export const prerender = false;

const TURN_HOST = 'turn.encrypt.click';
const TURN_TTL_SECONDS = 5 * 60;
const CLOUDFLARE_TURN_TTL_SECONDS = 5 * 60;
const METERED_API_TTL_SECONDS = 45 * 60;

let meteredCache: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;

type TurnProviderResult = {
  iceServers: RTCIceServer[];
  ttl: number;
  expiresAt?: number;
};

type TurnProviderName = 'cloudflare' | 'encrypt-1' | 'metered';

type TurnProviderAttempt = {
  provider: TurnProviderName;
  enabled: boolean;
  configured: boolean;
  ok: boolean;
  count: number;
  missing?: string[];
  error?: string;
};

function runtimeEnv(_locals: unknown): Record<string, unknown> {
  return workerEnv as Record<string, unknown>;
}

function envString(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(bytes).toString('base64');
}

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToBase64(new Uint8Array(signature));
}

function jsonResponse(body: Record<string, unknown>, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(init?.headers ?? {}),
    },
  });
}

function envNumber(env: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(envString(env, key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampTurnTtl(ttl: number): number {
  return Math.max(60, Math.min(300, Math.round(ttl)));
}

function assertIceServers(value: unknown, source: string): RTCIceServer[] {
  const iceServers = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { iceServers?: unknown }).iceServers)
      ? (value as { iceServers: unknown[] }).iceServers
      : null;

  if (!iceServers || iceServers.length === 0) {
    throw new Error(`${source} returned no ICE servers`);
  }

  return iceServers as RTCIceServer[];
}

async function loadEncryptOneIceServers(secret: string): Promise<TurnProviderResult> {
  const expiresAt = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = `${expiresAt}:${crypto.randomUUID()}`;
  const credential = await hmacSha1Base64(secret, username);

  return {
    iceServers: [{
      urls: [
        `turn:${TURN_HOST}:3478?transport=udp`,
        `turn:${TURN_HOST}:3478?transport=tcp`,
      ],
      username,
      credential,
    }],
    ttl: TURN_TTL_SECONDS,
    expiresAt,
  };
}

async function loadCloudflareIceServers(tokenId: string, apiToken: string, ttl: number): Promise<TurnProviderResult> {
  const res = await fetchNoRedirect(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(tokenId)}/credentials/generate-ice-servers`, {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl }),
  });
  if (!res.ok) throw new Error(`Cloudflare TURN API ${res.status}`);

  const iceServers = assertIceServers(await res.json(), 'Cloudflare TURN API');
  return { iceServers, ttl };
}

async function loadMeteredApiIceServers(apiKey: string, appHost: string): Promise<TurnProviderResult> {
  const now = Date.now();
  if (meteredCache && meteredCache.expiresAt > now) return { iceServers: meteredCache.iceServers, ttl: METERED_API_TTL_SECONDS };

  const url = new URL('/api/v1/turn/credentials', `https://${appHost}`);
  url.searchParams.set('apiKey', apiKey);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Metered TURN API ${res.status}`);

  const iceServers = assertIceServers(await res.json(), 'Metered TURN API');

  meteredCache = {
    iceServers,
    expiresAt: now + METERED_API_TTL_SECONDS * 1000,
  };
  return { iceServers, ttl: METERED_API_TTL_SECONDS };
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 120);
  return 'provider failed';
}

async function tryProvider(
  provider: TurnProviderName,
  enabled: boolean,
  missing: string[],
  load: () => Promise<TurnProviderResult>,
): Promise<{ result: TurnProviderResult | null; attempt: TurnProviderAttempt }> {
  const configured = missing.length === 0;
  if (!enabled || !configured) {
    return {
      result: null,
      attempt: {
        provider,
        enabled,
        configured,
        ok: false,
        count: 0,
        ...(missing.length ? { missing } : {}),
      },
    };
  }

  try {
    const result = await load();
    return {
      result,
      attempt: {
        provider,
        enabled,
        configured,
        ok: true,
        count: result.iceServers.length,
      },
    };
  } catch (error) {
    return {
      result: null,
      attempt: {
        provider,
        enabled,
        configured,
        ok: false,
        count: 0,
        error: publicErrorMessage(error),
      },
    };
  }
}

function turnResponse(results: TurnProviderResult[], diagnostics?: Record<string, unknown>) {
  const iceServers = results.flatMap((result) => result.iceServers);
  if (!iceServers.length) {
    return jsonResponse({
      iceServers: [],
      turnReady: false,
      ttl: 0,
      ...(diagnostics ? { diagnostics } : {}),
    });
  }

  const ttls = results.map((result) => result.ttl).filter((ttl) => ttl > 0);
  const expiresAtValues = results.map((result) => result.expiresAt).filter((value): value is number => typeof value === 'number');
  return jsonResponse({
    iceServers,
    turnReady: true,
    ttl: ttls.length ? Math.min(...ttls) : 0,
    ...(expiresAtValues.length ? { expiresAt: Math.min(...expiresAtValues) } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  });
}

export const GET: APIRoute = async ({ locals, request }) => {
  const env = runtimeEnv(locals);
  const grantSecret = envString(env, 'ROOM_TURN_SECRET');
  const grant = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  if (!await verifyTurnGrant(grantSecret, grant)) return jsonResponse({ error: 'Room authorization required' }, { status: 403 });
  const provider = envString(env, 'TURN_PROVIDER').toLowerCase();
  const autoProvider = !provider || provider === 'auto';
  const useEncryptOne = autoProvider || provider === 'encrypt-1' || provider === 'coturn';
  const useCloudflare = autoProvider || provider === 'cloudflare';
  const useMetered = false; // Static provider credentials cannot be safely scoped or expired.
  const secret =
    envString(env, 'TURN_AUTH_SECRET') ||
    envString(env, 'COTURN_AUTH_SECRET') ||
    envString(env, 'COTURN_SECRET') ||
    envString(env, 'TURN_SECRET') ||
    envString(env, 'AUTH_SECRET');

  const cloudflareTokenId = envString(env, 'CLOUDFLARE_TURN_TOKEN_ID') || envString(env, 'CLOUDFLARE_TURN_KEY_ID');
  const cloudflareApiToken = envString(env, 'CLOUDFLARE_TURN_API_TOKEN');
  const cloudflareTtl = clampTurnTtl(envNumber(env, 'CLOUDFLARE_TURN_TTL_SECONDS', CLOUDFLARE_TURN_TTL_SECONDS));
  const meteredApiKey = envString(env, 'METERED_TURN_API_KEY');
  const meteredApiHost = envString(env, 'METERED_TURN_API_HOST') || 'encrypt.metered.live';
  const debug = false;

  const attempts = await Promise.all([
    tryProvider(
      'cloudflare',
      useCloudflare,
      [
        ...(cloudflareTokenId ? [] : ['CLOUDFLARE_TURN_TOKEN_ID']),
        ...(cloudflareApiToken ? [] : ['CLOUDFLARE_TURN_API_TOKEN']),
      ],
      () => loadCloudflareIceServers(cloudflareTokenId, cloudflareApiToken, cloudflareTtl),
    ),
    tryProvider(
      'encrypt-1',
      useEncryptOne,
      secret ? [] : ['TURN_AUTH_SECRET'],
      () => loadEncryptOneIceServers(secret),
    ),
    tryProvider(
      'metered',
      useMetered,
      meteredApiKey ? [] : ['METERED_TURN_API_KEY'],
      () => loadMeteredApiIceServers(meteredApiKey, meteredApiHost),
    ),
  ]);

  const results = attempts.map((item) => item.result).filter((result): result is TurnProviderResult => Boolean(result));
  return turnResponse(results, debug ? {
    provider: provider || 'auto',
    autoProvider,
    attempts: attempts.map((item) => item.attempt),
  } : undefined);
};
