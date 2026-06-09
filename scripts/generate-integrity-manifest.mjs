import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIST_DIR = path.resolve('dist');
const MANIFEST_PATH = path.join(DIST_DIR, 'build-integrity.json');
const REPOSITORY = 'danielsebesta/encrypt';
const DEFAULT_BRANCH = 'main';

function git(args, fallback) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function toPublicPath(filePath) {
  return `/${path.relative(DIST_DIR, filePath).split(path.sep).join('/')}`;
}

function addRoute(routes, route, filePath) {
  routes[route] = filePath;
}

function addHtmlRoutes(routes, publicPath) {
  if (publicPath === '/index.html') {
    addRoute(routes, '/', publicPath);
    addRoute(routes, '/index.html', publicPath);
    return;
  }

  if (publicPath.endsWith('/index.html')) {
    const base = publicPath.slice(0, -'/index.html'.length) || '/';
    addRoute(routes, base, publicPath);
    addRoute(routes, `${base}/`, publicPath);
    addRoute(routes, publicPath, publicPath);
    return;
  }

  addRoute(routes, publicPath, publicPath);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (fullPath === MANIFEST_PATH) continue;

    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

const commitSha = process.env.CF_PAGES_COMMIT_SHA || git(['rev-parse', 'HEAD'], 'unknown');
const branch = process.env.CF_PAGES_BRANCH || git(['branch', '--show-current'], DEFAULT_BRANCH) || DEFAULT_BRANCH;
const files = {};
const routes = {};

for (const filePath of (await walk(DIST_DIR)).sort()) {
  const publicPath = toPublicPath(filePath);
  const buffer = await readFile(filePath);
  const fileStat = await stat(filePath);

  files[publicPath] = {
    sha256: sha256(buffer),
    bytes: fileStat.size,
  };

  if (publicPath.endsWith('.html')) {
    addHtmlRoutes(routes, publicPath);
  }
}

const rootDigest = sha256(
  Buffer.from(
    Object.keys(files)
      .sort()
      .map((filePath) => `${filePath}:${files[filePath].sha256}:${files[filePath].bytes}`)
      .join('\n'),
    'utf8',
  ),
);

const manifest = {
  version: 1,
  repository: REPOSITORY,
  branch,
  expectedBranch: DEFAULT_BRANCH,
  commitSha,
  builtAt: new Date().toISOString(),
  rootDigest,
  routes,
  files,
};

await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), MANIFEST_PATH)} for ${commitSha.slice(0, 12)}`);
