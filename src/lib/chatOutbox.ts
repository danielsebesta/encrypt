/** Text messages that have not reached the relay yet survive a reload of the tab. Only sealed bytes touch session storage. */

export const OUTBOX_STORAGE_PREFIX = 'encrypt.click:chat-outbox:v1:';
export const OUTBOX_MAX_ENTRIES = 50;
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_TEXT = 20_000;
const ID_RE = /^[A-Za-z0-9_:-]{1,64}$/;

export type OutboxEntry = {
  id: string;
  text: string;
  createdAt: number;
  ttl: number;
  once?: boolean;
  replyTo?: string;
};

export function outboxStorageKey(roomId: string, channel: string): string {
  return `${OUTBOX_STORAGE_PREFIX}${roomId}:${channel}`;
}

function isEntry(value: unknown): value is OutboxEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as OutboxEntry;
  return typeof entry.id === 'string' && ID_RE.test(entry.id)
    && typeof entry.text === 'string' && entry.text.trim().length > 0 && entry.text.length <= MAX_TEXT
    && Number.isFinite(entry.createdAt)
    && Number.isFinite(entry.ttl) && entry.ttl >= 0
    && (entry.once === undefined || typeof entry.once === 'boolean')
    && (entry.replyTo === undefined || (typeof entry.replyTo === 'string' && ID_RE.test(entry.replyTo)));
}

/** Entries that are still worth sending: well formed, not older than a day and not past their own timer. */
export function liveOutboxEntries(value: unknown, now = Date.now()): OutboxEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter(isEntry)
    .filter((entry) => now - entry.createdAt <= OUTBOX_MAX_AGE_MS && entry.createdAt <= now + 60_000)
    .filter((entry) => !entry.ttl || entry.createdAt + entry.ttl * 1000 > now)
    .filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-OUTBOX_MAX_ENTRIES);
}

export async function writeSealedOutbox(
  storage: Storage,
  roomId: string,
  channel: string,
  entries: OutboxEntry[],
  seal: (text: string) => Promise<string>,
): Promise<void> {
  const key = outboxStorageKey(roomId, channel);
  try {
    const live = liveOutboxEntries(entries);
    if (!live.length) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify({ v: 1, data: await seal(JSON.stringify(live)) }));
  } catch {}
}

export async function readSealedOutbox(
  storage: Storage,
  roomId: string,
  channel: string,
  open: (sealed: string) => Promise<string | null>,
  now = Date.now(),
): Promise<OutboxEntry[]> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(outboxStorageKey(roomId, channel));
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 || typeof parsed.data !== 'string') return [];
    const opened = await open(parsed.data);
    return opened ? liveOutboxEntries(JSON.parse(opened), now) : [];
  } catch {
    return [];
  }
}
