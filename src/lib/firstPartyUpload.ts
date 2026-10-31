import { mount, unmount } from 'svelte';
import {
  CHUNK_PLAIN_BYTES,
  MAX_CHUNKED_BYTES,
} from './httpLimits';
import {
  chunkCipherSize,
  chunkPlainSizes,
  createFileKey,
  expectedEnvelopeLength,
  manifestPlainLength,
  sealChunkManifest,
  sealFileChunk,
  type ChunkManifest,
} from './chunkedFile';
import { prependEclkMagic } from './ghost/crypto';
import { xhrRequest, type ByteProgress } from './httpProgress';
import { BLOB_ID_RE, BURN_HEADER, RETENTION_HEADER, type Retention } from './retention';
import { mapPool } from './transferProgress';
import { PASS_HEADER } from './uploadPass';

type Dict = Record<string, string>;

/** How many ciphertext parts to encrypt/upload at once for large shares. */
export const UPLOAD_CONCURRENCY = 3;
const RATE_RETRIES = 6;

// Kept only in memory: a pass is worth one solved challenge for an hour on this network and nothing after a reload.
let held: { pass: string; expires: number } | null = null;
let challenging: Promise<string | null> | null = null;

function heldPass(): string | null {
  if (held && held.expires - 60_000 > Date.now()) return held.pass;
  held = null;
  return null;
}

async function solveChallenge(dict: Dict): Promise<string | null> {
  try {
    const { default: UploadChallenge } = await import('../components/UploadChallenge.svelte');
    return await new Promise<string | null>(resolve => {
      let settled = false;
      const finish = (pass: string | null) => {
        if (settled) return;
        settled = true;
        void unmount(component);
        resolve(pass);
      };
      const component = mount(UploadChallenge, {
        target: document.body,
        props: {
          dict,
          onpass: (pass: string, expires: number) => { held = { pass, expires }; finish(pass); },
          oncancel: () => finish(null),
        },
      });
    });
  } catch {
    return null;
  }
}

function challenge(dict: Dict): Promise<string | null> {
  challenging ??= solveChallenge(dict).finally(() => { challenging = null; });
  return challenging;
}

function hasUploadBody(body: BodyInit | null | undefined): boolean {
  return body != null && body !== '';
}

function retryAfterMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get('Retry-After'));
  if (Number.isFinite(header) && header >= 0) return Math.min(60_000, Math.max(250, header * 1000));
  return Math.min(30_000, 500 * 2 ** attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(
  url: string,
  init: { method: string; body?: BodyInit | null; headers?: Record<string, string> },
  onUploadProgress?: ByteProgress,
): Promise<Response> {
  if (onUploadProgress && hasUploadBody(init.body)) {
    try {
      return await xhrRequest(url, { method: init.method, headers: init.headers, body: init.body }, onUploadProgress);
    } catch {
      // Progress is best-effort; a failed XHR still has to deliver the bytes via fetch.
      return fetch(url, init);
    }
  }
  return fetch(url, init);
}

export async function sendWithUploadPass(
  url: string,
  init: { method: string; body?: BodyInit | null; headers?: Record<string, string> },
  dict: Dict,
  onUploadProgress?: ByteProgress,
): Promise<Response> {
  const send = (pass: string | null, progress?: ByteProgress) => requestOnce(url, {
    ...init,
    headers: { ...init.headers, ...(pass ? { [PASS_HEADER]: pass } : {}) },
  }, progress);

  for (let attempt = 0; ; attempt++) {
    const res = await send(heldPass(), onUploadProgress);
    if (res.status === 428) {
      const reply = await res.clone().json().catch(() => null) as any;
      if (reply?.challenge !== 'pow') return res;
      held = null;
      const pass = await challenge(dict);
      if (!pass) return res;
      continue;
    }
    if (res.status === 429 && attempt < RATE_RETRIES) {
      await sleep(retryAfterMs(res, attempt));
      continue;
    }
    return res;
  }
}

export type UploadOptions = {
  retention?: Retention;
  burn?: boolean;
  onProgress?: ByteProgress;
};

export type FirstPartyUpload = { id: string; url: string; expires: number | null; burn: boolean };

/**
 * Uploads ciphertext to this site's own storage; the download link lives on the same origin. Without options the
 * server keeps its default of one day and any number of downloads.
 */
export async function uploadFirstParty(body: Uint8Array, dict: Dict, options?: UploadOptions): Promise<FirstPartyUpload | null> {
  try {
    const payload = prependEclkMagic(body);
    const res = await sendWithUploadPass('/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(options?.retention ? { [RETENTION_HEADER]: options.retention, [BURN_HEADER]: options.burn ? '1' : '0' } : {}),
      },
      body: payload as BodyInit,
    }, dict, options?.onProgress);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as any;
    if (!data?.success || typeof data.id !== 'string' || !BLOB_ID_RE.test(data.id)) return null;
    return {
      id: data.id,
      url: `${location.origin}/dl/${data.id}`,
      expires: Number.isSafeInteger(data.expires) ? data.expires : null,
      burn: data.burn === true,
    };
  } catch {
    return null;
  }
}

export type ChunkedUploadSource = {
  size: number;
  name: string;
  /** Returns one plaintext slice; called once per chunk index. */
  slice(offset: number, length: number): Promise<Uint8Array>;
};

/**
 * Encrypts and uploads a large file as a multipart first-party object. Send is not used: only this origin stores
 * the ciphertext parts. Retention and burn headers apply to the whole session. Ciphertext parts are sealed and
 * uploaded with limited concurrency so the uplink stays busy while the next chunk encrypts.
 */
export async function uploadFirstPartyChunked(
  source: ChunkedUploadSource,
  password: string,
  dict: Dict,
  options?: UploadOptions & { chunkSize?: number; timeSecret?: Uint8Array; concurrency?: number },
): Promise<FirstPartyUpload | null> {
  if (!Number.isSafeInteger(source.size) || source.size < 0 || source.size > MAX_CHUNKED_BYTES) return null;
  const chunkSize = options?.chunkSize ?? CHUNK_PLAIN_BYTES;
  const concurrency = Math.max(1, options?.concurrency ?? UPLOAD_CONCURRENCY);
  const sizes = chunkPlainSizes(source.size, chunkSize);
  const fileKey = createFileKey();
  const manifest: ChunkManifest = { name: source.name, size: source.size, chunkSize, chunks: sizes.length };
  try {
    const envelope = await sealChunkManifest(manifest, fileKey, password, options?.timeSecret);
    if (envelope.length !== expectedEnvelopeLength(manifestPlainLength(source.name, source.size, chunkSize, sizes.length))) {
      // Padmé is deterministic for a given plaintext length; a mismatch means the helpers drifted.
      throw new Error('Envelope size mismatch');
    }
    const part0 = prependEclkMagic(envelope);
    const partSizes = [part0.length, ...sizes.map((n) => chunkCipherSize(n))];
    const totalBytes = partSizes.reduce((sum, n) => sum + n, 0);
    const parts = partSizes.length;
    const partLoaded = new Array(parts).fill(0);
    const report = () => {
      if (!options?.onProgress) return;
      options.onProgress(partLoaded.reduce((a, b) => a + b, 0), totalBytes);
    };

    const init = await sendWithUploadPass('/upload/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.retention ? { [RETENTION_HEADER]: options.retention, [BURN_HEADER]: options.burn ? '1' : '0' } : {}),
      },
      body: JSON.stringify({ bytes: totalBytes, parts }),
    }, dict);
    if (!init.ok) return null;
    const started = await init.json().catch(() => null) as any;
    if (!started?.success || typeof started.id !== 'string' || !BLOB_ID_RE.test(started.id)) return null;
    const id = started.id as string;

    const putPart = async (index: number, body: Uint8Array) => {
      const res = await sendWithUploadPass(`/upload/${id}/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: body as BodyInit,
      }, dict, (loaded, total) => {
        partLoaded[index] = Math.min(body.length, total > 0 ? Math.round((loaded / total) * body.length) : loaded);
        report();
      });
      if (!res.ok) throw new Error(`part ${index} failed: HTTP ${res.status}`);
      partLoaded[index] = body.length;
      report();
    };

    await putPart(0, part0);

    const offsets = new Array<number>(sizes.length);
    let running = 0;
    for (let i = 0; i < sizes.length; i++) {
      offsets[i] = running;
      running += sizes[i];
    }

    await mapPool(sizes.length, concurrency, async (i) => {
      const plain = await source.slice(offsets[i], sizes[i]);
      if (plain.length !== sizes[i]) throw new Error('Short read');
      const sealed = await sealFileChunk(fileKey, i, plain);
      plain.fill(0);
      await putPart(i + 1, sealed);
    });

    const done = await sendWithUploadPass(`/upload/${id}/complete`, { method: 'POST' }, dict);
    if (!done.ok) return null;

    return {
      id,
      url: `${location.origin}/dl/${id}`,
      expires: Number.isSafeInteger(started.expires) ? started.expires : null,
      burn: started.burn === true,
    };
  } catch {
    return null;
  } finally {
    fileKey.fill(0);
  }
}
