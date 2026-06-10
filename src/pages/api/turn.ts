import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../lib/rateLimit';

export const prerender = false;

const TURN_HOST = 'turn.encrypt.click';
const TURN_TTL_SECONDS = 60 * 60;
const TURN_LIMIT = 120;

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

export const GET: APIRoute = async ({ locals, request }) => {
  const { ok, resetIn } = await checkRateLimit('turn', request, TURN_LIMIT);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(resetIn),
      },
    });
  }

  const env = runtimeEnv(locals);
  const secret =
    envString(env, 'TURN_AUTH_SECRET') ||
    envString(env, 'COTURN_AUTH_SECRET') ||
    envString(env, 'COTURN_SECRET') ||
    envString(env, 'TURN_SECRET') ||
    envString(env, 'AUTH_SECRET');

  if (!secret) {
    return new Response(JSON.stringify({
      iceServers: [],
      turnReady: false,
      ttl: 0,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

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

  return new Response(JSON.stringify({
    iceServers,
    turnReady: true,
    ttl: TURN_TTL_SECONDS,
    expiresAt,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};
