import { readFileSync, writeFileSync } from 'node:fs';

// The Cloudflare Vite plugin drops `routes` and `[assets]` from the generated config; copy them over from wrangler.toml.
const toml = readFileSync('wrangler.toml', 'utf8');
const block = toml.match(/^routes\s*=\s*\[([\s\S]*?)^\]/m)?.[1] ?? '';
const routes = [...block.matchAll(/\{\s*pattern\s*=\s*"([^"]+)"(?:\s*,\s*custom_domain\s*=\s*(true|false))?\s*\}/g)]
  .map(([, pattern, customDomain]) => customDomain === 'true' ? { pattern, custom_domain: true } : pattern);
const workersDev = /^workers_dev\s*=\s*true/m.test(toml);
const runFirst = toml.match(/^run_worker_first\s*=\s*\[([^\]]*)\]/m)?.[1];
const runWorkerFirst = runFirst ? [...runFirst.matchAll(/"([^"]+)"/g)].map(([, pattern]) => pattern) : null;
if (!routes.length && !workersDev && !runWorkerFirst) process.exit(0);

const path = 'dist/server/wrangler.json';
const config = JSON.parse(readFileSync(path, 'utf8'));
if (routes.length) config.routes = routes;
if (workersDev) config.workers_dev = true;
if (runWorkerFirst) config.assets = { ...(config.assets ?? {}), run_worker_first: runWorkerFirst };
writeFileSync(path, JSON.stringify(config));
console.log(`Merged ${routes.length} route(s) and ${runWorkerFirst ? runWorkerFirst.length : 0} worker-first pattern(s) into ${path}`);
