import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../lib/rateLimit';

export const prerender = false;

const TURN_HOST = 'turn.encrypt.click';
const TURN_TTL_SECONDS = 60 * 60;
const TURN_LIMIT = 120;
const METERED_TURN_DOMAIN = 'standard.relay.metered.ca';
const EXPRESSTURN_TURN_URLS = [
  'turn:free.expressturn.com:3478?transport=udp',
  'turn:free.expressturn.com:3478?transport=tcp',
];
const METERED_API_TTL_SECONDS = 45 * 60;

let meteredCache: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;

function runtimeEnv(locals: unknown): Record<string, unknown> {
  return ((locals as any).runtime?.env ?? process.env ?? {}) as Record<string, unknown>;
}

function envString(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value : '';
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

function meteredStaticIceServers(username: string, credential: string, domain = METERED_TURN_DOMAIN): RTCIceServer[] {
  return [
    { urls: `stun:stun.relay.metered.ca:80` },
    {
      urls: [
        `turn:${domain}:80`,
        `turn:${domain}:80?transport=tcp`,
        `turn:${domain}:443`,
        `turns:${domain}:443?transport=tcp`,
      ],
      username,
      credential,
    },
  ];
}

function parseTurnUrls(value: string, fallback: string[]): string[] {
  const urls = value
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter(Boolean);

  return urls.length ? urls : fallback;
}

function staticIceServers(urls: string[], username: string, credential: string): RTCIceServer[] {
  return [{ urls, username, credential }];
}

async function loadMeteredApiIceServers(apiKey: string, appHost: string): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (meteredCache && meteredCache.expiresAt > now) return meteredCache.iceServers;

  const url = new URL('/api/v1/turn/credentials', `https://${appHost}`);
  url.searchParams.set('apiKey', apiKey);

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Metered TURN API ${res.status}`);

  const iceServers = await res.json() as RTCIceServer[];
  if (!Array.isArray(iceServers) || iceServers.length === 0) {
    throw new Error('Metered TURN API returned no ICE servers');
  }

  meteredCache = {
    iceServers,
    expiresAt: now + METERED_API_TTL_SECONDS * 1000,
  };
  return iceServers;
}

export const GET: APIRoute = async ({ locals, request }) => {
  const { ok, resetIn } = await checkRateLimit('turn', request, TURN_LIMIT);
  if (!ok) {
    return jsonResponse({ error: 'Too many requests' }, {
      status: 429,
      headers: {
        'Retry-After': String(resetIn),
      },
    });
  }

  const env = runtimeEnv(locals);
  const provider = envString(env, 'TURN_PROVIDER').toLowerCase();
  const forceMetered = provider === 'metered';
  const forceStatic = provider === 'static' || provider === 'fallback' || provider === 'expressturn';
  const coturnOnly = provider === 'coturn';
  const secret =
    envString(env, 'TURN_AUTH_SECRET') ||
    envString(env, 'COTURN_AUTH_SECRET') ||
    envString(env, 'COTURN_SECRET') ||
    envString(env, 'TURN_SECRET') ||
    envString(env, 'AUTH_SECRET');

  if (!forceMetered && !forceStatic && secret) {
    const expiresAt = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
    const username = String(expiresAt);
    const credential = await hmacSha1Base64(secret, username);

    const iceServers: RTCIceServer[] = [{
      urls: [
        `turn:${TURN_HOST}:3478?transport=udp`,
        `turn:${TURN_HOST}:3478?transport=tcp`,
      ],
      username,
      credential,
    }];

    return jsonResponse({
      iceServers,
      turnReady: true,
      provider: 'coturn',
      ttl: TURN_TTL_SECONDS,
      expiresAt,
    });
  }

  if (coturnOnly) {
    return jsonResponse({
      iceServers: [],
      turnReady: false,
      ttl: 0,
    });
  }

  if (!forceStatic) {
    const meteredApiKey = envString(env, 'METERED_TURN_API_KEY');
    const meteredApiHost = envString(env, 'METERED_TURN_API_HOST') || 'encrypt.metered.live';
    if (meteredApiKey) {
      try {
        const iceServers = await loadMeteredApiIceServers(meteredApiKey, meteredApiHost);
        return jsonResponse({
          iceServers,
          turnReady: true,
          provider: 'metered',
          ttl: METERED_API_TTL_SECONDS,
        });
      } catch {}
    }

    const meteredUsername =
      envString(env, 'METERED_TURN_USERNAME') ||
      envString(env, 'METERED_TURN_STATIC_USERNAME');
    const meteredCredential =
      envString(env, 'METERED_TURN_CREDENTIAL') ||
      envString(env, 'METERED_TURN_PASSWORD') ||
      envString(env, 'METERED_TURN_STATIC_CREDENTIAL');
    const meteredDomain = envString(env, 'METERED_TURN_DOMAIN') || METERED_TURN_DOMAIN;

    if (meteredUsername && meteredCredential) {
      return jsonResponse({
        iceServers: meteredStaticIceServers(meteredUsername, meteredCredential, meteredDomain),
        turnReady: true,
        provider: 'metered',
        ttl: TURN_TTL_SECONDS,
      });
    }
  }

  const staticUsername =
    envString(env, 'FALLBACK_TURN_USERNAME') ||
    envString(env, 'EXPRESSTURN_TURN_USERNAME');
  const staticCredential =
    envString(env, 'FALLBACK_TURN_CREDENTIAL') ||
    envString(env, 'FALLBACK_TURN_PASSWORD') ||
    envString(env, 'EXPRESSTURN_TURN_CREDENTIAL') ||
    envString(env, 'EXPRESSTURN_TURN_PASSWORD');
  const staticUrls = parseTurnUrls(
    envString(env, 'FALLBACK_TURN_URLS') || envString(env, 'EXPRESSTURN_TURN_URLS'),
    EXPRESSTURN_TURN_URLS
  );

  if (staticUsername && staticCredential) {
    return jsonResponse({
      iceServers: staticIceServers(staticUrls, staticUsername, staticCredential),
      turnReady: true,
      provider: provider || 'static',
      ttl: TURN_TTL_SECONDS,
    });
  }

  return jsonResponse({
    iceServers: [],
    turnReady: false,
    ttl: 0,
  });
};
