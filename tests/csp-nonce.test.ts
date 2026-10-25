import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withCloudflareScriptNonce } from '../src/server/csp';

const HASH_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-abc='; style-src 'self' 'unsafe-inline'";

test('appends a script nonce to hash-only HTML CSP and disables caching', () => {
  const res = withCloudflareScriptNonce(
    new Response('<html></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': HASH_CSP },
    }),
  );
  const csp = res.headers.get('Content-Security-Policy')!;
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' 'sha256-abc=' 'nonce-[A-Za-z0-9+/=]+'/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('leaves responses that already have a nonce alone', () => {
  const csp = "script-src 'self' 'nonce-already';";
  const res = withCloudflareScriptNonce(
    new Response('ok', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': csp } }),
  );
  assert.equal(res.headers.get('Content-Security-Policy'), csp);
  assert.equal(res.headers.get('Cache-Control'), null);
});

test('ignores non-HTML and CSP-less responses', () => {
  const json = withCloudflareScriptNonce(
    new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': HASH_CSP } }),
  );
  assert.equal(json.headers.get('Content-Security-Policy'), HASH_CSP);

  const bare = withCloudflareScriptNonce(
    new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }),
  );
  assert.equal(bare.headers.get('Content-Security-Policy'), null);
});
