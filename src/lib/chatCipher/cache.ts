import { PACKS, cacheName, packTotalBytes, type ChatLanguage, type PackManifest } from './packs';

export type PackStatus =
  | { state: 'bundled' }
  | { state: 'missing'; bytes: number }
  | { state: 'ready'; bytes: number }
  | { state: 'downloading'; received: number; total: number }
  | { state: 'error'; message: string };

const inflight = new Map<ChatLanguage, Promise<void>>();

export async function getPackStatus(lang: ChatLanguage): Promise<PackStatus> {
  const pack = PACKS[lang];
  if (pack.bundled) return { state: 'bundled' };
  if (typeof caches === 'undefined') return { state: 'missing', bytes: packTotalBytes(pack) };
  const cache = await caches.open(cacheName(pack));
  for (const file of pack.files) {
    if (!file.path) continue;
    const hit = await cache.match(packUrl(pack, file.path));
    if (!hit) return { state: 'missing', bytes: packTotalBytes(pack) };
  }
  return { state: 'ready', bytes: packTotalBytes(pack) };
}

export function packUrl(pack: PackManifest, path: string): string {
  return new URL(pack.base + path.replace(/^\//, ''), typeof location !== 'undefined' ? location.origin : 'https://encrypt.click').href;
}

export async function ensurePack(
  lang: ChatLanguage,
  onProgress?: (status: PackStatus) => void,
): Promise<void> {
  const pack = PACKS[lang];
  if (pack.bundled) {
    onProgress?.({ state: 'bundled' });
    return;
  }
  const current = await getPackStatus(lang);
  if (current.state === 'ready') {
    onProgress?.(current);
    return;
  }
  const existing = inflight.get(lang);
  if (existing) return existing;

  const run = (async () => {
    if (typeof caches === 'undefined') throw new Error('Cache API unavailable');
    const total = packTotalBytes(pack) || pack.files.length;
    let received = 0;
    onProgress?.({ state: 'downloading', received, total });
    const cache = await caches.open(cacheName(pack));
    for (const file of pack.files) {
      if (!file.path) continue;
      const url = packUrl(pack, file.path);
      const res = await fetch(url, { mode: 'same-origin', credentials: 'omit', cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not download language pack (${res.status})`);
      const buf = await res.arrayBuffer();
      if (file.sha256) {
        const hash = await sha256Hex(buf);
        if (hash !== file.sha256) throw new Error('Language pack checksum mismatch');
      }
      await cache.put(url, new Response(buf, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } }));
      received += file.bytes || buf.byteLength;
      onProgress?.({ state: 'downloading', received, total: total || received });
    }
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* ignore */
    }
    onProgress?.({ state: 'ready', bytes: received });
  })();

  inflight.set(lang, run);
  try {
    await run;
  } finally {
    inflight.delete(lang);
  }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const dig = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(dig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** True when every file for this pack is already in Cache Storage (or bundled). */
export async function assertOffline(lang: ChatLanguage): Promise<void> {
  const status = await getPackStatus(lang);
  if (status.state === 'bundled' || status.state === 'ready') return;
  throw new Error('Download the language pack before encrypting or decrypting');
}
