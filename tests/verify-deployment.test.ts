import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const generator = path.join(root, 'scripts', 'generate-integrity-manifest.mjs');
const verifier = path.join(root, 'scripts', 'verify-deployment.mjs');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

const INLINE = '(function(){document.documentElement.className="js"})();';
const page = (title: string, stars: string) => `<!doctype html><html><head><title>${title}</title><script>${INLINE}</script><script src="/_astro/app.abc.js" defer></script><link rel="stylesheet" href="/_astro/app.abc.css"></head><body><astro-island uid="Z1nUMGC" component-url="/_astro/app.abc.js"></astro-island><a href="https://github.com/o/r">GitHub${stars}</a></body></html>\n`;
const starBadge = (count: string) => `<span data-astro-cid-x>★ ${count}</span>`;

const FILES: Record<string, string | Buffer> = {
  'index.html': page('home', starBadge('30')),
  'cs/index.html': page('domu', starBadge('30')),
  'security/index.html': page('security', starBadge('30')),
  '404.html': page('missing', ''),
  '_astro/app.abc.js': 'export const answer = 42;\n',
  '_astro/app.abc.css': 'body{margin:0}\n',
  'boot.js': Buffer.from([0, 1, 2, 3, 250, 251, 252]),
  '_headers': `/*\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-abc='\n\n/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
  '_redirects': '/privacy /security 301\n',
  '.assetsignore': 'wrangler.json\n.dev.vars\n',
};

let work: string;
let counter = 0;

before(() => {
  work = mkdtempSync(path.join(tmpdir(), 'encrypt-verify-'));
});

after(() => {
  rmSync(work, { recursive: true, force: true });
});

function writeTree(client: string, files: Record<string, string | Buffer>) {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(client, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function generate(buildRoot: string, env: Record<string, string> = {}) {
  const run = spawnSync(process.execPath, [generator], {
    cwd: buildRoot,
    env: { ...process.env, BUILD_COMMIT_SHA: COMMIT, SOURCE_DATE_EPOCH: '1760000000', ...env },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
}

function newBuild(files: Record<string, string | Buffer> = FILES, env: Record<string, string> = {}) {
  const buildRoot = path.join(work, `build-${counter++}`);
  const client = path.join(buildRoot, 'dist', 'client');
  writeTree(client, files);
  generate(buildRoot, env);
  return { buildRoot, client };
}

function mimeOf(file: string) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function parseRules(text: string) {
  const rules: { pattern: string; headers: [string, string][] }[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: [] });
    else {
      const colon = line.indexOf(':');
      rules[rules.length - 1].headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
    }
  }
  return rules;
}

async function serve(client: string, injectHtml: (html: string) => string = (html) => html): Promise<{ url: string; server: Server }> {
  const rules = existsSync(path.join(client, '_headers')) ? parseRules(readFileSync(path.join(client, '_headers'), 'utf8')) : [];
  const redirects = new Map<string, [string, number]>();
  if (existsSync(path.join(client, '_redirects'))) {
    for (const line of readFileSync(path.join(client, '_redirects'), 'utf8').split('\n')) {
      const [from, to, status] = line.trim().split(/\s+/);
      if (from && to) redirects.set(from, [to, Number(status ?? 301)]);
    }
  }
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const send = (status: number, body: string | Buffer, type: string) => {
      const headers: Record<string, string> = { 'content-type': type };
      for (const rule of rules) {
        const matches = rule.pattern === '/*' || (rule.pattern.endsWith('/*') && pathname.startsWith(rule.pattern.slice(0, -1)));
        if (matches) for (const [name, value] of rule.headers) headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
      }
      response.writeHead(status, headers);
      const payload: string | Buffer = type.startsWith('text/html') ? injectHtml(body.toString()) : body;
      response.end(payload);
    };
    const redirect = redirects.get(pathname);
    if (redirect) {
      response.writeHead(redirect[1], { location: redirect[0] });
      response.end();
      return;
    }
    const file = path.join(client, pathname);
    const hidden = pathname === '/_headers' || pathname === '/_redirects' || pathname === '/.assetsignore';
    if (!hidden && file.startsWith(client) && existsSync(file) && !file.endsWith(path.sep) && pathname !== '/' && !existsSync(path.join(file, 'index.html'))) {
      send(200, readFileSync(file), mimeOf(file));
    } else if (!hidden && existsSync(path.join(file, 'index.html'))) {
      if (!pathname.endsWith('/')) {
        response.writeHead(307, { location: `${pathname}/` });
        response.end();
      } else {
        send(200, readFileSync(path.join(file, 'index.html')), 'text/html; charset=utf-8');
      }
    } else {
      send(404, existsSync(path.join(client, '404.html')) ? readFileSync(path.join(client, '404.html')) : 'not found', 'text/html; charset=utf-8');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

function run(args: string[]): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [verifier, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (status) => resolve({ status, out }));
  });
}

async function check(local: string, live: string, extra: string[] = [], injectHtml?: (html: string) => string) {
  const { url, server } = await serve(live, injectHtml);
  try {
    return await run([url, '--dist', local, '--concurrency', '4', ...extra]);
  } finally {
    server.close();
  }
}

function liveCopy(from: { client: string }, change: (client: string) => void, regenerate: Record<string, string> | false = {}) {
  const buildRoot = path.join(work, `live-${counter++}`);
  const client = path.join(buildRoot, 'dist', 'client');
  cpSync(from.client, client, { recursive: true });
  rmSync(path.join(client, 'build-integrity.json'));
  change(client);
  if (regenerate !== false) generate(buildRoot, regenerate);
  else cpSync(path.join(from.client, 'build-integrity.json'), path.join(client, 'build-integrity.json'));
  return client;
}

test('the manifest is reproducible: no build time, only the commit date', () => {
  const first = newBuild();
  const second = newBuild();
  const a = JSON.parse(readFileSync(path.join(first.client, 'build-integrity.json'), 'utf8'));
  const b = JSON.parse(readFileSync(path.join(second.client, 'build-integrity.json'), 'utf8'));
  assert.deepEqual(a, b);
  assert.equal(a.commitSha, COMMIT);
  assert.equal(a.sourceDate, '2025-10-09T08:53:20.000Z');
  assert.equal('builtAt' in a, false);
  assert.match(a.rootDigest, /^[0-9a-f]{64}$/);
  assert.equal(a.files['/_astro/app.abc.js'].bytes, FILES['_astro/app.abc.js'].length);
});

test('an identical deployment verifies', async () => {
  const build = newBuild();
  const result = await check(build.client, liveCopy(build, () => {}));
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /OK: http:\/\/127\.0\.0\.1:\d+ serves exactly this build/);
  assert.match(result.out, /7 identical/);
});

test('a different GitHub star count in the footer is the only HTML difference tolerated', async () => {
  const build = newBuild();
  const live = liveCopy(build, (client) => {
    for (const name of ['index.html', 'cs/index.html', 'security/index.html']) {
      const file = path.join(client, name);
      writeFileSync(file, readFileSync(file, 'utf8').replace(starBadge('30'), starBadge('1,234')));
    }
  });
  const result = await check(build.client, live);
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /3 identical except the GitHub star count/);

  const other = liveCopy(build, (client) => {
    const file = path.join(client, 'index.html');
    writeFileSync(file, readFileSync(file, 'utf8').replace('GitHub', 'GitHub<script src="//evil.example/x.js"></script>'));
  });
  const tampered = await check(build.client, other);
  assert.equal(tampered.status, 1, tampered.out);
  assert.match(tampered.out, /mismatch: \/index\.html/);
});

const cloudflareScript = (src: string, r = 'a4f789243a7ea15d', t = 'MTc5MjgyOTc0Nw==') => `<script>(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'${r}',t:'${t}'};var a=document.createElement('script');a.src='${src}';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script>`;

test('Astro island ids may differ between build directories, nothing else about an island may', async () => {
  const build = newBuild();
  const live = liveCopy(build, (client) => {
    const file = path.join(client, 'index.html');
    writeFileSync(file, readFileSync(file, 'utf8').replace('uid="Z1nUMGC"', 'uid="22WiS9"'));
  });
  const result = await check(build.client, live);
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /1 identical except Astro island ids/);

  const other = liveCopy(build, (client) => {
    const file = path.join(client, 'index.html');
    writeFileSync(file, readFileSync(file, 'utf8').replace('component-url="/_astro/app.abc.js"', 'component-url="//evil.example/x.js"'));
  });
  const tampered = await check(build.client, other);
  assert.equal(tampered.status, 1, tampered.out);
  assert.match(tampered.out, /mismatch: \/index\.html/);
});

test('the bot-detection script Cloudflare appends to pages is ignored, any other appended script is not', async () => {
  const build = newBuild();
  const live = liveCopy(build, () => {});
  const appended = (script: string) => (html: string) => html.replace('</body>', `${script}</body>`);

  const cloudflare = await check(build.client, live, [], appended(cloudflareScript('/cdn-cgi/challenge-platform/scripts/jsd/main.js')));
  assert.equal(cloudflare.status, 0, cloudflare.out);
  assert.match(cloudflare.out, /4 served with Cloudflare's bot-detection script appended/);

  const lookalike = await check(build.client, live, [], appended(cloudflareScript('//evil.example/main.js')));
  assert.equal(lookalike.status, 1, lookalike.out);
  assert.match(lookalike.out, /mismatch: \/index\.html/);

  const other = await check(build.client, live, [], appended('<script src="/cdn-cgi/other.js"></script>'));
  assert.equal(other.status, 1, other.out);
});

test('a script changed on the server is reported even when the host rewrites its manifest', async () => {
  const build = newBuild();
  const live = liveCopy(build, (client) => writeFileSync(path.join(client, '_astro', 'app.abc.js'), 'export const answer = 43;\n'));
  const result = await check(build.client, live);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /MISMATCH mismatch: \/_astro\/app\.abc\.js/);
  assert.match(result.out, /first difference at byte 23/);
  assert.match(result.out, /FAILED: 1 problem/);
});

test('a file that differs from the host\'s own manifest is reported', async () => {
  const build = newBuild();
  const live = liveCopy(build, (client) => writeFileSync(path.join(client, 'boot.js'), Buffer.from([9, 9, 9])), false);
  const result = await check(build.client, live);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /boot\.js/);
  assert.match(result.out, /differs from the deployed manifest/);
});

test('a changed Content-Security-Policy is reported', async () => {
  const build = newBuild();
  const live = liveCopy(build, (client) => {
    const file = path.join(client, '_headers');
    writeFileSync(file, readFileSync(file, 'utf8').replace("'sha256-abc='", "'sha256-abc=' 'unsafe-inline'"));
  });
  const result = await check(build.client, live);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /MISMATCH header: content-security-policy on \d+ responses?, first \//);
  assert.match(result.out, /expected default-src 'self'; script-src 'self' 'sha256-abc='$/m);
});

test('a listed file the server no longer serves is reported', async () => {
  const build = newBuild();
  const live = liveCopy(build, (client) => rmSync(path.join(client, '_astro', 'app.abc.css')), false);
  const result = await check(build.client, live);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /status: \/_astro\/app\.abc\.css/);
  assert.match(result.out, /answered 404, expected 200/);
});

test('a deployment of another commit is named as such', async () => {
  const build = newBuild();
  const live = liveCopy(build, () => {}, { BUILD_COMMIT_SHA: 'f'.repeat(40) });
  const result = await check(build.client, live);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /commit: the local build is of 0123456789ab but the deployment is ffffffffffff/);
  assert.match(result.out, /git checkout f{40}/);
});

test('files missing on either side are reported', async () => {
  const build = newBuild();
  const extraLive = liveCopy(build, (client) => writeTree(client, { 'extra.js': 'x' }));
  const first = await check(build.client, extraLive);
  assert.equal(first.status, 1, first.out);
  assert.match(first.out, /missing locally: \/extra\.js/);

  const smallerLive = liveCopy(build, (client) => rmSync(path.join(client, 'boot.js')));
  const second = await check(build.client, smallerLive);
  assert.equal(second.status, 1, second.out);
  assert.match(second.out, /unlisted: \/boot\.js/);
});

test('changed redirects are reported', async () => {
  const build = newBuild();
  const live = liveCopy(build, (client) => writeFileSync(path.join(client, '_redirects'), '/privacy /elsewhere 301\n'));
  const result = await check(build.client, live);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /redirect rule: \/privacy -> \/security/);
});

test('usage errors and unreachable sites exit with status 2', async () => {
  const build = newBuild();
  assert.equal((await run([])).status, 2);
  assert.equal((await run(['not a url'])).status, 2);
  assert.equal((await run(['--help'])).status, 0);
  const missing = await run(['http://127.0.0.1:1', '--dist', build.client]);
  assert.equal(missing.status, 2, missing.out);
  assert.match(missing.out, /Could not fetch/);
  const noDist = await run(['http://127.0.0.1:1', '--dist', path.join(work, 'nothing-here')]);
  assert.equal(noDist.status, 2, noDist.out);
  assert.match(noDist.out, /Cannot read the local build/);
});
