import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { build as bundle } from 'esbuild';

process.env.DEPLOY_TARGET = 'node';
rmSync('dist', { recursive: true, force: true });

const { build } = await import('astro');
await build({});

for (const script of ['scripts/inject-csp-hashes.mjs', 'scripts/generate-integrity-manifest.mjs']) {
  execFileSync(process.execPath, [script], { stdio: 'inherit' });
}

await bundle({
  entryPoints: ['src/adapters/node/server.ts'],
  outfile: 'dist/node/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'info',
});
