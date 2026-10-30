import { createCoverCodec, parseCoverTable, type CoverCodec } from './tableCodec';

/** Changing the table breaks every existing cover, so a new one needs a new path. */
export const COVER_TABLE_URL = '/chat-cipher/cs/2/table.bin';
export const COVER_TABLE_SHA256 = '0f81bf2edb0c726e3ac4df671b515a0177f1a79ee26e02c5f4875add5e31de8a';

let loading: Promise<CoverCodec> | null = null;

async function fetchCodec(cache: RequestCache): Promise<CoverCodec> {
  const res = await fetch(COVER_TABLE_URL, { mode: 'same-origin', credentials: 'omit', cache });
  if (!res.ok) throw new Error(`Could not download the word table (${res.status})`);
  const packed = await res.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', packed));
  const hash = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== COVER_TABLE_SHA256) throw new Error('Word table checksum mismatch');
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return createCoverCodec(parseCoverTable(new Uint8Array(await new Response(stream).arrayBuffer())));
}

function load(cache: RequestCache): Promise<CoverCodec> {
  loading ??= fetchCodec(cache).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** The word table, fetched once per tab. The browser's HTTP cache keeps it for later visits and offline use. */
export function loadCoverCodec(): Promise<CoverCodec> {
  return load('default');
}

/** Fetches past the HTTP cache, which would otherwise keep serving a damaged copy. */
export function reloadCoverCodec(): Promise<CoverCodec> {
  loading = null;
  return load('reload');
}

/** Frees what the earlier neural models left in this browser, up to about 140 MB. */
export async function dropRetiredModels(): Promise<void> {
  if (typeof caches === 'undefined') return;
  for (const name of await caches.keys()) {
    if (name.startsWith('chat-cipher-') || name === 'transformers-cache') await caches.delete(name);
  }
}
