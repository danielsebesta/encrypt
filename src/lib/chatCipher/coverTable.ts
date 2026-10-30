import { packUrl, sha256Hex } from './cache';
import { PACKS } from './packs';
import { createCoverCodec, parseCoverTable, type CoverCodec } from './tableCodec';

let loading: Promise<CoverCodec> | null = null;

async function fetchCodec(): Promise<CoverCodec> {
  const pack = PACKS.cs;
  const file = pack.files[0]!;
  const res = await fetch(packUrl(pack, file.path), { mode: 'same-origin', credentials: 'omit' });
  if (!res.ok) throw new Error(`Could not download language pack (${res.status})`);
  const packed = await res.arrayBuffer();
  if ((await sha256Hex(packed)) !== file.sha256) throw new Error('Language pack checksum mismatch');
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return createCoverCodec(parseCoverTable(new Uint8Array(await new Response(stream).arrayBuffer())));
}

/** The Czech word table, fetched once per tab. The browser's HTTP cache keeps it for later visits and offline use. */
export function loadCoverCodec(): Promise<CoverCodec> {
  loading ??= fetchCodec().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function dropCoverCodec(): void {
  loading = null;
}
