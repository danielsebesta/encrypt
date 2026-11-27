const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const RETENTIONS = ['1h', '1d', '7d'] as const;
export type Retention = (typeof RETENTIONS)[number];
export const DEFAULT_RETENTION: Retention = '1d';

export const RETENTION_MS: Readonly<Record<Retention, number>> = { '1h': HOUR_MS, '1d': DAY_MS, '7d': 7 * DAY_MS };

export const LEGACY_TTL_MS = DAY_MS;

export const RETENTION_HEADER = 'X-Upload-Retention';
export const BURN_HEADER = 'X-Upload-Burn';

export const UNLOCK_MARGIN_MS = HOUR_MS;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ID_PREFIX: Readonly<Record<Retention, string>> = { '1h': 't1h-', '1d': '', '7d': 't7d-' };

export const BLOB_ID_RE = new RegExp(`^(?:t(?:1h|7d)-)?${UUID}$`);

export function isRetention(value: unknown): value is Retention {
  return typeof value === 'string' && (RETENTIONS as readonly string[]).includes(value);
}

export function retentionDays(retention: Retention): number {
  return Math.max(1, Math.ceil(RETENTION_MS[retention] / DAY_MS));
}

export function blobId(retention: Retention, uuid: string): string {
  return `${ID_PREFIX[retention]}${uuid}`;
}

export function retentionOfId(id: string): Retention {
  if (id.startsWith('t1h-')) return '1h';
  if (id.startsWith('t7d-')) return '7d';
  return '1d';
}

export function uuidOfId(id: string): string {
  return id.replace(/^t(?:1h|7d)-/, '');
}

export function retentionForUnlock(chosen: Retention, unlockMs: number | null, now = Date.now()): Retention | null {
  if (unlockMs === null) return chosen;
  const start = RETENTIONS.indexOf(chosen);
  return RETENTIONS.slice(start).find(retention => now + RETENTION_MS[retention] >= unlockMs + UNLOCK_MARGIN_MS) ?? null;
}

export function latestUploadUnlock(now = Date.now()): number {
  return now + RETENTION_MS['7d'] - UNLOCK_MARGIN_MS;
}
