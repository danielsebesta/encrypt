import { readFileSync, writeFileSync } from 'node:fs';

// The Cloudflare Vite plugin drops `routes`, `[assets]` and sometimes R2 bindings; copy them from wrangler.toml.
const toml = readFileSync('wrangler.toml', 'utf8');
const block = toml.match(/^routes\s*=\s*\[([\s\S]*?)^\]/m)?.[1] ?? '';
const routes = [...block.matchAll(/\{\s*pattern\s*=\s*"([^"]+)"(?:\s*,\s*custom_domain\s*=\s*(true|false))?\s*\}/g)]
  .map(([, pattern, customDomain]) => customDomain === 'true' ? { pattern, custom_domain: true } : pattern);
const workersDev = /^workers_dev\s*=\s*(true|false)/m.exec(toml)?.[1];
const previewUrls = /^preview_urls\s*=\s*(true|false)/m.exec(toml)?.[1];
const runFirst = toml.match(/^run_worker_first\s*=\s*\[([^\]]*)\]/m)?.[1];
const runWorkerFirst = runFirst ? [...runFirst.matchAll(/"([^"]+)"/g)].map(([, pattern]) => pattern) : null;

const r2Buckets = [];
for (const chunk of toml.split('[[r2_buckets]]').slice(1)) {
  const binding = chunk.match(/binding\s*=\s*"([^"]+)"/)?.[1];
  const bucket_name = chunk.match(/bucket_name\s*=\s*"([^"]+)"/)?.[1];
  const jurisdiction = chunk.match(/jurisdiction\s*=\s*"([^"]+)"/)?.[1];
  if (binding && bucket_name) {
    r2Buckets.push(jurisdiction ? { binding, bucket_name, jurisdiction } : { binding, bucket_name });
  }
}

if (!routes.length && !workersDev && !runWorkerFirst && !r2Buckets.length) process.exit(0);

const path = 'dist/server/wrangler.json';
const config = JSON.parse(readFileSync(path, 'utf8'));
if (routes.length) config.routes = routes;
if (workersDev) config.workers_dev = workersDev === 'true';
if (previewUrls) config.preview_urls = previewUrls === 'true';
if (runWorkerFirst) config.assets = { ...(config.assets ?? {}), run_worker_first: runWorkerFirst };
if (r2Buckets.length) config.r2_buckets = r2Buckets;
writeFileSync(path, JSON.stringify(config));
console.log(
  `Merged ${routes.length} route(s), ${runWorkerFirst ? runWorkerFirst.length : 0} worker-first pattern(s), ${r2Buckets.length} r2 bucket(s) into ${path}`,
);
