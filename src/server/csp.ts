/**
 * Cloudflare Bot Fight injects a per-request inline detection script. Hashes cannot cover it.
 * When script-src already lists a nonce, Cloudflare stamps that nonce onto its script.
 * Prerendered HTML is served from ASSETS with hash-only CSP, so the Worker must append one.
 */
export function withCloudflareScriptNonce(response: Response): Response {
  const type = response.headers.get('Content-Type') ?? '';
  if (!type.includes('text/html')) return response;
  const csp = response.headers.get('Content-Security-Policy');
  if (!csp || !/\bscript-src\b/i.test(csp) || /'nonce-[^']+'/i.test(csp)) return response;

  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  const headers = new Headers(response.headers);
  headers.set(
    'Content-Security-Policy',
    csp.replace(/\bscript-src\b([^;]*)/i, (_, rest: string) => `script-src${rest} 'nonce-${nonce}'`),
  );
  // A cached response would reuse the nonce while Cloudflare injects a fresh script.
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
