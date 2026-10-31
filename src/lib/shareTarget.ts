/** Shared content parked by public/sw.js; the names must match that file. */
export const SHARE_INBOX = 'share-target-inbox';
export const SHARE_META_PATH = '/share-target/meta';
export const SHARE_FILE_PATH = '/share-target/file/';
export const SHARE_MAX_AGE_MS = 10 * 60 * 1000;
export const SHARE_MAX_FILES = 100;

export interface SharedMeta {
  at: number;
  title: string;
  text: string;
  url: string;
  files: { name: string; type: string }[];
}

export interface SharedContent {
  text: string;
  files: File[];
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function safeFileName(name: string, index: number): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base && base !== '.' && base !== '..' ? base.slice(0, 255) : `shared-${index + 1}`;
}

/** The inbox metadata, or null when it is malformed or older than a few minutes. */
export function parseSharedMeta(value: unknown, now = Date.now()): SharedMeta | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const at = Number(record.at);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > SHARE_MAX_AGE_MS) return null;
  const files = Array.isArray(record.files)
    ? record.files.slice(0, SHARE_MAX_FILES).map((file, index) => {
        const entry = (file && typeof file === 'object' ? file : {}) as Record<string, unknown>;
        return { name: safeFileName(str(entry.name), index), type: str(entry.type) };
      })
    : [];
  return { at, title: str(record.title), text: str(record.text), url: str(record.url), files };
}

/** Title, text and link joined into one message, leaving out a part that another part already contains. */
export function composeSharedText(meta: Pick<SharedMeta, 'title' | 'text' | 'url'>): string {
  const parts = [meta.title, meta.text, meta.url].map((part) => part.trim()).filter(Boolean);
  return parts
    .filter((part, i) => !parts.some((other, j) => j !== i && other.includes(part) && (other.length > part.length || j < i)))
    .join('\n');
}

/** Takes pending shared content out of the local inbox and always empties it. */
export async function takeSharedContent(): Promise<SharedContent | null> {
  try {
    if (typeof caches === 'undefined' || !(await caches.has(SHARE_INBOX))) return null;
  } catch {
    return null;
  }
  try {
    const inbox = await caches.open(SHARE_INBOX);
    const stored = await inbox.match(SHARE_META_PATH);
    const meta = parseSharedMeta(stored ? await stored.json() : null);
    if (!meta) return null;
    const files: File[] = [];
    for (const [index, entry] of meta.files.entries()) {
      const body = await inbox.match(`${SHARE_FILE_PATH}${index}`);
      if (body) files.push(new File([await body.blob()], entry.name, { type: entry.type, lastModified: meta.at }));
    }
    const text = composeSharedText(meta);
    return files.length > 0 || text ? { text, files } : null;
  } catch {
    return null;
  } finally {
    await caches.delete(SHARE_INBOX).catch(() => false);
  }
}
