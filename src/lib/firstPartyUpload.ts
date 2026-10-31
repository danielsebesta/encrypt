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
import { BLOB_ID_RE, BURN_HEADER, RETENTION_HEADER, type Retention } from './retention';
import { PASS_HEADER } from './uploadPass';

type Dict = Record<string, string>;

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

export async function sendWithUploadPass(
  url: string,
  init: { method: string; body?: BodyInit | null; headers?: Record<string, string> },
  dict: Dict,
): Promise<Response> {
  const send = (pass: string | null) => fetch(url, {
    ...init,
    headers: { ...init.headers, ...(pass ? { [PASS_HEADER]: pass } : {}) },
  });
  const res = await send(heldPass());
  if (res.status !== 428) return res;
  const reply = await res.clone().json().catch(() => null) as any;
  if (reply?.challenge !== 'pow') return res;
  held = null;
  const pass = await challenge(dict);
  return pass ? send(pass) : res;
}

export type UploadOptions = { retention: Retention; burn: boolean };
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
        ...(options ? { [RETENTION_HEADER]: options.retention, [BURN_HEADER]: options.burn ? '1' : '0' } : {}),
      },
      body: payload as BodyInit,
    }, dict);
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
 * the ciphertext parts. Retention and burn headers apply to the whole session. Only one plaintext chunk and its
 * ciphertext are held at a time after the manifest is sealed.
 */
export async function uploadFirstPartyChunked(
  source: ChunkedUploadSource,
  password: string,
  dict: Dict,
  options?: UploadOptions & { chunkSize?: number; timeSecret?: Uint8Array },
): Promise<FirstPartyUpload | null> {
  if (!Number.isSafeInteger(source.size) || source.size < 0 || source.size > MAX_CHUNKED_BYTES) return null;
  const chunkSize = options?.chunkSize ?? CHUNK_PLAIN_BYTES;
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
    const totalBytes = part0.length + sizes.reduce((sum, n) => sum + chunkCipherSize(n), 0);
    const parts = 1 + sizes.length;

    const init = await sendWithUploadPass('/upload/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options ? { [RETENTION_HEADER]: options.retention, [BURN_HEADER]: options.burn ? '1' : '0' } : {}),
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
      }, dict);
      if (!res.ok) throw new Error('part failed');
    };

    await putPart(0, part0);
    let offset = 0;
    for (let i = 0; i < sizes.length; i++) {
      const plain = await source.slice(offset, sizes[i]);
      if (plain.length !== sizes[i]) throw new Error('Short read');
      const sealed = await sealFileChunk(fileKey, i, plain);
      plain.fill(0);
      await putPart(i + 1, sealed);
      offset += sizes[i];
    }

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
