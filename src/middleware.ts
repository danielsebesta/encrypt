import type { MiddlewareHandler } from 'astro';

const CSP_STRICT =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests;";
const CSP_DEV =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none';";

const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '0',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Access-Control-Allow-Origin': 'https://encrypt.click',
  'Content-Security-Policy': CSP_STRICT
};

export const onRequest: MiddlewareHandler = async (context, next) => {
  const response = await next();
  const mutable = new Response(response.body, response);
  const isDev = import.meta.env.DEV;
  const headers = { ...SECURITY_HEADERS };
  if (isDev) {
    headers['Content-Security-Policy'] = CSP_DEV;
  }
  for (const [key, value] of Object.entries(headers)) {
    mutable.headers.set(key, value);
  }
  return mutable;
};

