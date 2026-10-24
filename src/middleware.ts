import { defineMiddleware } from 'astro:middleware';

const SCRIPT_HASHES = '__CSP_SCRIPT_HASHES__';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (context.isPrerendered) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // Cross-origin isolation keeps the page in its own process, out of reach of Spectre-style reads from other sites.
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  headers.set('Cache-Control', 'no-store');
  let body: BodyInit | null = response.body;
  if (headers.get('Content-Type')?.includes('text/html')) {
    // Our inline scripts are allowed by the hashes the build swaps in, so the HTML is never rewritten and request data
    // that reached it could not pick up a nonce. The nonce stays in the header only for Cloudflare's injected bot
    // detection script, which reads it from there. The dev server, where the placeholder stays, tags our scripts instead.
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
    let scripts = `${SCRIPT_HASHES} 'nonce-${nonce}'`;
    if (SCRIPT_HASHES.startsWith('__')) {
      body = (await response.text()).replace(/<script\b/gi, `<script nonce="${nonce}"`);
      headers.delete('Content-Length');
      scripts = `'nonce-${nonce}'`;
    }
    headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' ${scripts} 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests`);
  } else if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox; frame-ancestors 'none'");
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
});
