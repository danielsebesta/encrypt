/**
 * Stages Chat cipher language packs and optionally uploads them to R2 `encrypt-models`.
 *
 * EN: onnx-community/Falcon-H1-Tiny-90M-Instruct-ONNX q4f16 only (~94 MB)
 * CS needs no model: its word table ships in public/chat-cipher (built by ../chat-model/table).
 *
 *   node scripts/prepare-chat-cipher-models.mjs
 *   node scripts/prepare-chat-cipher-models.mjs --upload
 *   pnpm run deploy
 */
import { createHash } from 'crypto';
import { mkdir, writeFile, readFile, readdir, stat, copyFile } from 'fs/promises';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { globSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staging = join(root, '.models-staging');
const enDir = join(staging, 'models/chat-cipher/en/2');
const ortDir = join(staging, 'models/ort');
const upload = process.argv.includes('--upload');
const bucket = 'encrypt-models';

const enRepo = 'onnx-community/Falcon-H1-Tiny-90M-Instruct-ONNX';
const enRevision = 'main';
const generatedPath = join(root, 'src/lib/chatCipher/packs.generated.json');

const enFiles = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_q4f16.onnx',
  'onnx/model_q4f16.onnx_data',
];

/** All ORT WASM entrypoints transformers.js may pick (jsep / asyncify / jspi / plain). */
const ortNames = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jspi.mjs',
  'ort-wasm-simd-threaded.jspi.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
];

async function download(url) {
  console.log('GET', url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function write(path, buf) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  console.log(relative(staging, path), buf.byteLength, sha256.slice(0, 12));
  return { sha256, bytes: buf.byteLength };
}

const enManifest = [];
for (const path of enFiles) {
  const buf = await download(`https://huggingface.co/${enRepo}/resolve/${enRevision}/${path}`);
  const meta = await write(join(enDir, path), buf);
  enManifest.push({ path, ...meta });
}
const enTotal = enManifest.reduce((s, f) => s + f.bytes, 0);
console.log('EN Falcon pack', (enTotal / (1024 * 1024)).toFixed(1), 'MB');

const ortHits = globSync('node_modules/.pnpm/onnxruntime-web@*/node_modules/onnxruntime-web/dist', {
  cwd: root,
  absolute: true,
});
const ortDist = ortHits[0];
if (!ortDist) throw new Error('onnxruntime-web dist not found under node_modules/.pnpm');
for (const name of ortNames) {
  try {
    await mkdir(ortDir, { recursive: true });
    await copyFile(join(ortDist, name), join(ortDir, name));
    console.log('ORT', name, (await readFile(join(ortDir, name))).byteLength);
  } catch (e) {
    console.warn('ORT skip', name, e.message);
  }
}

await writeFile(
  join(enDir, 'manifest.json'),
  JSON.stringify({ repo: enRepo, revision: enRevision, files: enManifest }, null, 2),
);
const generated = JSON.parse(await readFile(generatedPath, 'utf8'));
await writeFile(generatedPath, JSON.stringify({ ...generated, en: enManifest }, null, 2));
console.log('staging ready →', staging);

if (!upload) {
  console.log('Next: node scripts/prepare-chat-cipher-models.mjs --upload');
  console.log('Then:  pnpm run deploy');
  process.exit(0);
}

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

for (const file of await walk(join(staging, 'models'))) {
  const key = relative(staging, file).replace(/\\/g, '/');
  if (key.startsWith('models/chat-cipher/en/1/')) {
    console.log('skip stale', key);
    continue;
  }
  console.log('R2 put', key);
  const result = spawnSync(
    'pnpm',
    ['exec', 'wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file, '--jurisdiction', 'eu', '--remote'],
    { cwd: root, stdio: 'inherit', shell: true },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('upload done — deploy with: pnpm run deploy');
