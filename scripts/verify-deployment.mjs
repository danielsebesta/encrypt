#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const USAGE = `Usage: node scripts/verify-deployment.mjs <site-url> [--dist <dir>] [--concurrency <n>] [--timeout <ms>] [--verbose]

Compares a deployed site with a local build of the same commit. Nothing is built here:
run "pnpm build" on the commit named in the site's /build-integrity.json first.

  <site-url>       origin to check, for example https://encrypt.click
  --dist <dir>     local build output (default: dist/client)
  --concurrency    parallel requests (default: 8)
  --timeout        per-request timeout in milliseconds (default: 30000)
  --verbose        list every file that matched

Exit status: 0 everything matches, 1 at least one mismatch, 2 the check could not run.`;

const MANIFEST_NAME = 'build-integrity.json';
const NOT_SERVED = new Set(['/_headers', '/_redirects', '/_routes.json', '/_worker.js', '/.assetsignore']);
const MISSING_PAGE = '/__verify-deployment-missing-page';
const STAR_BADGE = /(?<=GitHub)<span[^>]*>\xe2\x98\x85 [\d,]+<\/span>(?=<\/a>)/g;
// Cloudflare appends this bot-detection snippet to every HTML response when JavaScript Detections is on; only its two per-request values vary.
const CLOUDFLARE_SNIPPET = String.raw`<script>(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'@R@',t:'@T@'};var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);";b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';document.body.appendChild(a);if('loading'!==document.readyState)c();else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();</script>`;
const CLOUDFLARE_INJECTION = new RegExp(CLOUDFLARE_SNIPPET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('@R@', '[0-9a-f]+').replace('@T@', '[A-Za-z0-9+/=]+'), 'g');
const ISLAND_UID = /(?<=<astro-island\b[^>]*?\buid=")[A-Za-z0-9]+(?=")/g;
const PLATFORM_HEADERS = new Set(['server']);
const NOTES = {
  stars: { short: 'GitHub star count', summary: 'identical except the GitHub star count in the footer' },
  uids: { short: 'Astro island ids', summary: 'identical except Astro island ids, which depend on the build path' },
  cloudflare: { short: 'Cloudflare bot-detection script', summary: "served with Cloudflare's bot-detection script appended" },
};
const MAX_PER_KIND = 8;

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const options = { dist: 'dist/client', concurrency: 8, timeout: 30_000, verbose: false, site: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--dist' || arg === '--concurrency' || arg === '--timeout') {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value\n\n${USAGE}`);
      if (arg === '--dist') options.dist = value;
      else if (!/^\d+$/.test(value) || Number(value) < 1) fail(`${arg} needs a positive number\n\n${USAGE}`);
      else options[arg.slice(2)] = Number(value);
    } else if (arg.startsWith('-')) {
      fail(`Unknown option ${arg}\n\n${USAGE}`);
    } else if (options.site === null) {
      options.site = arg;
    } else {
      fail(`Unexpected argument ${arg}\n\n${USAGE}`);
    }
  }
  if (!options.site) fail(USAGE);
  let url;
  try {
    url = new URL(options.site);
  } catch {
    fail(`Not a valid URL: ${options.site}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail('The site URL must start with https:// or http://');
  options.origin = url.origin;
  return options;
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const short = (hash) => (hash ? hash.slice(0, 12) : 'none');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Strings are handled as latin1 so every byte survives the round trip.
function stripFromHtml(publicPath, buffer, pattern) {
  if (!publicPath.endsWith('.html')) return buffer;
  const text = buffer.toString('latin1');
  const stripped = text.replace(pattern, '');
  return stripped === text ? buffer : Buffer.from(stripped, 'latin1');
}

const withoutCloudflare = (publicPath, buffer) => stripFromHtml(publicPath, buffer, CLOUDFLARE_INJECTION);
// The footer shows the GitHub star count fetched while building, so builds made at different times differ in that one badge.
const withoutStars = (publicPath, buffer) => stripFromHtml(publicPath, buffer, STAR_BADGE);
// Astro derives each island's id from the absolute path of its component, so the same commit built in another directory gets other ids.
const withoutUids = (publicPath, buffer) => stripFromHtml(publicPath, buffer, ISLAND_UID);
const NORMALIZERS = { stars: withoutStars, uids: withoutUids };

function explainDifference(publicPath, a, b) {
  for (const names of [['stars'], ['uids'], ['stars', 'uids']]) {
    const normalize = (buffer) => names.reduce((current, name) => NORMALIZERS[name](publicPath, current), buffer);
    if (sha256(normalize(a)) === sha256(normalize(b))) return names;
  }
  return null;
}

function firstDifference(a, b) {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : length;
}

function excerpt(buffer, offset) {
  const start = Math.max(0, offset - 30);
  return buffer.subarray(start, start + 90).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function readLocal(distDir) {
  let paths;
  try {
    paths = await walk(distDir);
  } catch {
    fail(`Cannot read the local build at ${distDir}. Run "pnpm build" first or pass --dist.`);
  }
  const files = new Map();
  let manifest = null;
  for (const full of paths) {
    const publicPath = `/${path.relative(distDir, full).split(path.sep).join('/')}`;
    const bytes = await readFile(full);
    if (publicPath === `/${MANIFEST_NAME}`) {
      try {
        manifest = JSON.parse(bytes.toString('utf8'));
      } catch {
        fail(`${full} is not valid JSON`);
      }
      continue;
    }
    files.set(publicPath, bytes);
  }
  if (files.size === 0) fail(`${distDir} contains no files`);
  return { files, manifest };
}

function rootDigestOf(files) {
  return sha256(Buffer.from(
    Object.keys(files).sort().map((file) => `${file}:${files[file].sha256}:${files[file].bytes}`).join('\n'),
    'utf8',
  ));
}

function encodePath(publicPath) {
  return publicPath.split('/').map(encodeURIComponent).join('/');
}

function routeFor(publicPath, routes) {
  if (publicPath === '/404.html') return MISSING_PAGE;
  if (!publicPath.endsWith('.html')) return publicPath;
  const candidates = Object.entries(routes ?? {}).filter(([, file]) => file === publicPath).map(([route]) => route);
  return candidates.find((route) => route.endsWith('/')) ?? candidates.find((route) => route !== publicPath) ?? publicPath;
}

function patternRegExp(pattern) {
  const source = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/:[A-Za-z]\w*/g, '[^/]+');
  return new RegExp(`^${source}$`);
}

function parseHeadersFile(text) {
  const rules = [];
  const ignored = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), matches: patternRegExp(raw.trim().replace(/^https?:\/\/[^/]+/, '')), headers: [] };
      rules.push(current);
      continue;
    }
    const line = raw.trim();
    if (line.startsWith('!')) {
      ignored.push(line);
      continue;
    }
    const colon = line.indexOf(':');
    if (current && colon > 0) current.headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return { rules, ignored };
}

function expectedHeaders(rules, requestPath) {
  const merged = new Map();
  for (const rule of rules) {
    if (!rule.matches.test(requestPath)) continue;
    for (const [name, value] of rule.headers) merged.set(name, merged.has(name) ? `${merged.get(name)}, ${value}` : value);
  }
  return merged;
}

function parseRedirectsFile(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [from, to, status = '301'] = line.split(/\s+/);
    if (from && to && !/[*:]/.test(from)) rules.push({ from, to, status: Number(status) });
  }
  return rules;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { origin } = options;
  const problems = [];
  const notes = [];
  const problem = (kind, detail, extra = []) => problems.push({ kind, detail, extra });

  async function request(url, redirect = 'follow') {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          redirect,
          cache: 'no-store',
          headers: { 'accept': '*/*', 'accept-language': 'en', 'cache-control': 'no-cache', 'user-agent': 'encrypt-click-verify/1' },
          signal: AbortSignal.timeout(options.timeout),
        });
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          const wait = Math.min(Number(response.headers.get('retry-after')) || attempt, 10);
          await response.body?.cancel();
          await sleep(wait * 1000);
          continue;
        }
        const body = redirect === 'manual' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
        return { response, body };
      } catch (error) {
        lastError = error;
        await sleep(400 * attempt);
      }
    }
    throw lastError;
  }

  console.log(`Verifying ${origin} against ${options.dist}\n`);

  const local = await readLocal(path.resolve(options.dist));

  let liveManifest;
  try {
    const { response, body } = await request(`${origin}/${MANIFEST_NAME}?ec_verify=${Date.now()}`);
    if (!response.ok) fail(`${origin}/${MANIFEST_NAME} answered ${response.status}; this deployment publishes no build manifest.`);
    liveManifest = JSON.parse(body.toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${origin}/${MANIFEST_NAME} is not valid JSON`);
    fail(`Could not fetch ${origin}/${MANIFEST_NAME}: ${error.cause?.code ?? error.message}`);
  }
  if (!liveManifest || typeof liveManifest.files !== 'object' || liveManifest.files === null) fail('The deployed build manifest has no file list');

  const describe = (manifest) => manifest
    ? `commit ${manifest.commitSha ?? 'unknown'}${manifest.sourceDate ? `, source date ${manifest.sourceDate}` : ''}${manifest.build?.node ? `, node ${manifest.build.node}` : ''}`
    : 'no build-integrity.json found';
  console.log(`  deployed  ${describe(liveManifest)}`);
  console.log(`  local     ${describe(local.manifest)}\n`);

  const liveSha = liveManifest.commitSha;
  const localSha = local.manifest?.commitSha;
  if (!liveSha || liveSha === 'unknown') {
    notes.push('The deployment does not say which commit it was built from.');
  } else if (!localSha || localSha === 'unknown') {
    notes.push('The local build does not record its commit, so the commit could not be compared.');
  } else if (liveSha !== localSha) {
    problem('commit', `the local build is of ${localSha.slice(0, 12)} but the deployment is ${liveSha.slice(0, 12)}`, [
      `Check out the deployed commit and build it: git checkout ${liveSha} && pnpm install --frozen-lockfile && pnpm build`,
    ]);
  }
  if (liveManifest.build?.lockfileSha256 && local.manifest?.build?.lockfileSha256 && liveManifest.build.lockfileSha256 !== local.manifest.build.lockfileSha256) {
    notes.push('The dependency lockfile differs from the one the deployment was built with.');
  }

  const declaredFiles = liveManifest.files;
  if (typeof liveManifest.rootDigest === 'string' && rootDigestOf(declaredFiles) !== liveManifest.rootDigest) {
    problem('manifest', 'the deployed manifest is not consistent with its own root digest');
  }

  const livePaths = Object.keys(declaredFiles).sort();
  const localPaths = [...local.files.keys()].sort();
  for (const file of livePaths) {
    if (!file.startsWith('/') || file.split('/').includes('..')) problem('manifest', `unexpected path in the deployed manifest: ${file}`);
    else if (!local.files.has(file)) problem('missing locally', file, ['listed by the deployment but absent from the local build']);
  }
  for (const file of localPaths) {
    if (!(file in declaredFiles)) problem('unlisted', file, ['present in the local build but not listed by the deployment']);
  }

  const toFetch = livePaths.filter((file) => local.files.has(file) && !NOT_SERVED.has(file));
  for (const file of livePaths.filter((entry) => local.files.has(entry) && NOT_SERVED.has(entry))) {
    const declared = declaredFiles[file].sha256;
    const actual = sha256(local.files.get(file));
    if (declared !== actual) problem('mismatch', file, [`not served publicly; local ${short(actual)} differs from the hash in the deployed manifest ${short(declared)}`]);
  }
  const headerRules = local.files.has('/_headers') ? parseHeadersFile(local.files.get('/_headers').toString('utf8')) : { rules: [], ignored: [] };
  if (headerRules.ignored.length > 0) notes.push('Header removal rules ("! name") in _headers are not checked.');
  if (headerRules.rules.some((rule) => rule.headers.some(([name]) => PLATFORM_HEADERS.has(name)))) notes.push('The Server header is set by the hosting platform and is not compared.');
  const matched = [];
  const headerChecks = { paths: 0, headers: 0 };
  const headerProblems = [];

  await mapLimit(toFetch, options.concurrency, async (file) => {
    const requestPath = routeFor(file, liveManifest.routes);
    let result;
    try {
      result = await request(`${origin}${encodePath(requestPath)}`);
    } catch (error) {
      problem('unreachable', file, [`${requestPath}: ${error.cause?.code ?? error.message}`]);
      return;
    }
    const { response, body } = result;
    const expectedStatus = file === '/404.html' ? 404 : 200;
    if (new URL(response.url).origin !== origin) {
      problem('redirect', file, [`${requestPath} ended up at ${response.url}`]);
      return;
    }
    if (response.status !== expectedStatus) {
      problem('status', file, [`${requestPath} answered ${response.status}, expected ${expectedStatus}`]);
      return;
    }

    const localBytes = local.files.get(file);
    const served = withoutCloudflare(file, body);
    const manifestHash = declaredFiles[file].sha256;
    const details = [];
    const ignored = [];
    if (served !== body) ignored.push('cloudflare');
    if (sha256(served) !== manifestHash) details.push(`served ${short(sha256(served))} differs from the deployed manifest ${short(manifestHash)}`);
    if (sha256(localBytes) !== sha256(served)) {
      const explained = explainDifference(file, localBytes, served);
      if (explained) {
        ignored.push(...explained);
      } else {
        const offset = firstDifference(localBytes, served);
        details.push(
          `local ${short(sha256(localBytes))} differs from served ${short(sha256(served))}, first difference at byte ${offset}`,
          `local  ${excerpt(localBytes, offset)}`,
          `served ${excerpt(served, offset)}`,
        );
      }
    }
    if (details.length > 0) problem('mismatch', file, details);
    else matched.push({ file, ignored });

    headerChecks.paths++;
    for (const [name, expected] of expectedHeaders(headerRules.rules, requestPath)) {
      if (PLATFORM_HEADERS.has(name)) continue;
      headerChecks.headers++;
      const actual = response.headers.get(name);
      if (actual !== expected) headerProblems.push({ file: requestPath, name, expected, actual });
    }
  });
  const headerGroups = new Map();
  for (const item of headerProblems.sort((a, b) => a.file.localeCompare(b.file))) {
    const key = JSON.stringify([item.name, item.expected, item.actual]);
    if (!headerGroups.has(key)) headerGroups.set(key, { ...item, count: 0 });
    headerGroups.get(key).count++;
  }
  for (const item of headerGroups.values()) {
    problem('header', `${item.name} on ${item.count} response${item.count === 1 ? '' : 's'}, first ${item.file}`, [`expected ${item.expected}`, `served   ${item.actual ?? 'missing'}`]);
  }

  const redirects = local.files.has('/_redirects') ? parseRedirectsFile(local.files.get('/_redirects').toString('utf8')) : [];
  await mapLimit(redirects, options.concurrency, async ({ from, to, status }) => {
    try {
      const { response } = await request(`${origin}${encodePath(from)}`, 'manual');
      const location = response.headers.get('location');
      const target = location ? new URL(location, origin) : null;
      const wanted = new URL(to, origin);
      const redirected = response.status === status && target && target.origin === wanted.origin && target.pathname + target.search === wanted.pathname + wanted.search;
      // Paths the Worker answers first never reach _redirects; a page that is listed in the manifest and served there is as intended.
      const servedPage = response.status === 200 && (from in (liveManifest.routes ?? {}) || `${from}/` in (liveManifest.routes ?? {}));
      if (!redirected && !servedPage) {
        problem('redirect rule', `${from} -> ${to}`, [`served ${response.status}${location ? ` to ${location}` : ''}, expected ${status}`]);
      }
    } catch (error) {
      problem('unreachable', from, [error.cause?.code ?? error.message]);
    }
  });

  const byNote = (note) => matched.filter((item) => item.ignored.includes(note)).length;
  const exact = matched.filter((item) => item.ignored.length === 0).length;
  const skipped = [...NOT_SERVED].filter((file) => local.files.has(file));
  if (options.verbose) {
    for (const item of matched.sort((a, b) => a.file.localeCompare(b.file))) {
      const notes = item.ignored.map((note) => NOTES[note].short).join(', ');
      console.log(`  ok        ${item.file}${notes ? ` (ignored: ${notes})` : ''}`);
    }
    console.log('');
  }

  const failedKinds = new Set(problems.map((item) => item.kind));
  const row = (ok, label, detail) => console.log(`  ${ok ? 'OK      ' : 'MISMATCH'} ${label.padEnd(10)} ${detail}`);
  const commitKnown = liveSha && localSha && liveSha !== 'unknown' && localSha !== 'unknown';
  const fileKinds = ['mismatch', 'missing locally', 'unlisted', 'unreachable', 'status', 'redirect'];
  row(!failedKinds.has('commit'), 'commit', commitKnown ? `${liveSha.slice(0, 12)} deployed, local build ${liveSha === localSha ? 'matches' : 'differs'}` : 'not comparable');
  row(!failedKinds.has('manifest'), 'manifest', `${livePaths.length} files listed, root digest ${short(liveManifest.rootDigest)}${local.manifest?.rootDigest === liveManifest.rootDigest ? ' equals the local one' : ''}`);
  row(!fileKinds.some((kind) => failedKinds.has(kind)), 'files', `${[`${exact} identical`, ...Object.keys(NOTES).filter(byNote).map((note) => `${byNote(note)} ${NOTES[note].summary}`)].join(', ')}, compared with what ${origin} serves`);
  row(!failedKinds.has('header'), 'headers', `${headerChecks.headers} header values on ${headerChecks.paths} responses compared with _headers`);
  row(!failedKinds.has('redirect rule'), 'redirects', `${redirects.length} rules compared with _redirects`);
  if (skipped.length > 0) console.log(`  note     ${skipped.join(', ')} are not served by the platform: _headers and _redirects were checked through the responses above, and each local file through the hash in the deployed manifest`);
  for (const note of notes) console.log(`  note     ${note}`);

  if (problems.length > 0) {
    problems.sort((a, b) => a.kind.localeCompare(b.kind) || a.detail.localeCompare(b.detail));
    const shown = new Map();
    for (const item of problems) {
      const count = shown.get(item.kind) ?? 0;
      shown.set(item.kind, count + 1);
      if (count === 0) console.log('');
      if (count < MAX_PER_KIND) {
        console.log(`  MISMATCH ${item.kind}: ${item.detail}`);
        for (const extra of item.extra) console.log(`             ${extra}`);
      }
    }
    for (const [kind, count] of shown) if (count > MAX_PER_KIND) console.log(`  ... and ${count - MAX_PER_KIND} more ${kind} problems`);
    if (fileKinds.some((kind) => failedKinds.has(kind) && kind !== 'status')) {
      console.log('\n  hint     Builds are byte-identical on the same operating system. The deployment is built on Linux (ubuntu-latest in CI); on Windows rebuild in WSL or Docker.');
    }
    console.log(`\nFAILED: ${problems.length} problem${problems.length === 1 ? '' : 's'}. ${origin} does not match this build.`);
    process.exit(1);
  }
  console.log(`\nOK: ${origin} serves exactly this build${liveSha && liveSha !== 'unknown' ? ` (commit ${liveSha.slice(0, 12)})` : ''}.`);
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

main().catch((error) => fail(`Verification could not finish: ${error.message}`));
