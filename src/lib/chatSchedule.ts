/** Client-side scheduled send presets. The ciphertext leaves the device only at sendAt. */

export type SchedulePreset = {
  id: string;
  /** Offset from now in ms; 0 means custom / absolute. */
  offsetMs: number;
};

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { id: '1m', offsetMs: 60_000 },
  { id: '5m', offsetMs: 5 * 60_000 },
  { id: '15m', offsetMs: 15 * 60_000 },
  { id: '1h', offsetMs: 60 * 60_000 },
];

export const SCHEDULE_MAX_AHEAD_MS = 7 * 24 * 60 * 60_000;
export const SCHEDULE_MIN_AHEAD_MS = 15_000;
export const SCHEDULE_STORAGE_PREFIX = 'encrypt.click:chat-schedule:v1:';

export type ScheduledDraft = {
  id: string;
  text: string;
  sendAt: number;
  once: boolean;
  replyTo?: string;
};

export function scheduleAt(offsetMs: number, now = Date.now()): number {
  return now + offsetMs;
}

export function validSendAt(sendAt: number, now = Date.now()): boolean {
  if (!Number.isFinite(sendAt)) return false;
  const delta = sendAt - now;
  return delta >= SCHEDULE_MIN_AHEAD_MS && delta <= SCHEDULE_MAX_AHEAD_MS;
}

export function formatScheduleAt(sendAt: number, locale: string, now = Date.now()): string {
  const delta = sendAt - now;
  if (delta < 60_000) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.max(1, Math.round(delta / 1000)), 'second');
  if (delta < 60 * 60_000) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(delta / 60_000), 'minute');
  if (delta < 24 * 60 * 60_000) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(delta / 3_600_000), 'hour');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(sendAt);
}

export function scheduleStorageKey(roomId: string, channel: string): string {
  return `${SCHEDULE_STORAGE_PREFIX}${roomId}:${channel}`;
}

function isScheduledDraft(value: unknown): value is ScheduledDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as ScheduledDraft;
  return typeof draft.id === 'string'
    && typeof draft.text === 'string'
    && draft.text.trim().length > 0
    && Number.isFinite(draft.sendAt)
    && typeof draft.once === 'boolean'
    && (draft.replyTo === undefined || typeof draft.replyTo === 'string');
}

export function parseScheduledDrafts(raw: string | null, now = Date.now()): ScheduledDraft[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isScheduledDraft)
      .filter((draft) => draft.sendAt >= now - SCHEDULE_MIN_AHEAD_MS && draft.sendAt - now <= SCHEDULE_MAX_AHEAD_MS)
      .sort((a, b) => a.sendAt - b.sendAt);
  } catch {
    return [];
  }
}

export function readScheduledDrafts(storage: Storage, roomId: string, channel: string, now = Date.now()): ScheduledDraft[] {
  try {
    return parseScheduledDrafts(storage.getItem(scheduleStorageKey(roomId, channel)), now);
  } catch {
    return [];
  }
}

export function writeScheduledDrafts(storage: Storage, roomId: string, channel: string, drafts: ScheduledDraft[]): void {
  const key = scheduleStorageKey(roomId, channel);
  try {
    if (!drafts.length) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(drafts));
  } catch {}
}

const SEALED_DRAFTS_V = 2;

/** Drafts at rest carry no plaintext: the room key seals the JSON before it touches session storage. */
export async function writeSealedDrafts(
  storage: Storage,
  roomId: string,
  channel: string,
  drafts: ScheduledDraft[],
  seal: (text: string) => Promise<string>,
): Promise<void> {
  const key = scheduleStorageKey(roomId, channel);
  try {
    if (!drafts.length) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify({ v: SEALED_DRAFTS_V, data: await seal(JSON.stringify(drafts)) }));
  } catch {}
}

/** Reads v2 sealed drafts; a legacy plaintext array still parses and gets resealed on the next write. */
export async function readSealedDrafts(
  storage: Storage,
  roomId: string,
  channel: string,
  open: (sealed: string) => Promise<string | null>,
  now = Date.now(),
): Promise<ScheduledDraft[]> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(scheduleStorageKey(roomId, channel));
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parseScheduledDrafts(raw, now);
    if (parsed?.v !== SEALED_DRAFTS_V || typeof parsed.data !== 'string') return [];
    const opened = await open(parsed.data);
    return opened ? parseScheduledDrafts(opened, now) : [];
  } catch {
    return [];
  }
}
