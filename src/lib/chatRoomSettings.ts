export const RETENTION_SECONDS = [5, 10, 30, 60, 300, 900, 3600, 86400] as const;

export type ChatMode = 'live' | 'persistent' | `ttl-${number}`;

// Saved rooms live in their own Durable Object class, so the persistent mode is only valid where that class asks for it.
export function normalizeChatMode(value: unknown, allowPersistent = false): ChatMode {
  if (value === 'live') return 'live';
  if (value === 'persistent') return allowPersistent ? 'persistent' : 'live';
  if (value === 'burn') return 'ttl-10';
  if (typeof value === 'string') {
    const match = /^ttl-(\d{1,6})$/.exec(value);
    if (match && (RETENTION_SECONDS as readonly number[]).includes(Number(match[1]))) return value as ChatMode;
  }
  return 'live';
}

export function chatModeTtlSeconds(mode: ChatMode): number {
  return mode.startsWith('ttl-') ? Number(mode.slice(4)) : 0;
}

export function chatModeKeepsHistory(mode: ChatMode): boolean {
  return mode === 'live' || mode === 'persistent';
}

export const PERSISTENT_HISTORY_LIMIT = 1000;
export const PERSISTENT_HISTORY_BYTES = 24 * 1024 * 1024;
export const PERSISTENT_PAYLOAD_CHARS = 64_000;
export const PERSISTENT_IDLE_DAYS = 90;
export const ROOM_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

const UNITS = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]] as const;

export function formatDuration(seconds: number, locale: string, unitDisplay: 'long' | 'short' = 'long'): string {
  const [unit, size] = UNITS.find(([, s]) => seconds >= s && seconds % s === 0) ?? UNITS[3];
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay }).format(seconds / size);
}

export const MIN_ROOM_PASSWORD_LENGTH = 12;
const PASSPHRASE_LENGTH = 20;

export type PasswordChecks = { length: boolean; variety: boolean; distinct: boolean };

export function checkRoomPassword(password: string, roomName: string): PasswordChecks {
  const value = password.trim();
  const lower = value.toLowerCase();
  const room = roomName.trim().toLowerCase();
  return {
    length: value.length >= MIN_ROOM_PASSWORD_LENGTH,
    variety: value.length >= PASSPHRASE_LENGTH || /[^\p{L}]/u.test(value),
    distinct: value.length > 0 && (!room || (lower !== room && !(room.length >= 3 && lower.includes(room)))),
  };
}

export function roomPasswordOk(password: string, roomName: string): boolean {
  const checks = checkRoomPassword(password, roomName);
  return checks.length && checks.variety && checks.distinct;
}

// A trailing "!N" makes one message disappear after N seconds in any room mode. Out-of-range or
// fractional values are clamped rather than ignored, so a typo never turns a private message permanent.
const BURN_SUFFIX = /\s*!(\d{1,9}(?:[.,]\d*)?)$/;
const BURN_MAX_SECONDS = 3600;

export function parseBurnSuffix(raw: string): { text: string; ttl: number } | null {
  const match = raw.match(BURN_SUFFIX);
  if (!match) return null;
  const text = raw.slice(0, match.index).trim();
  if (!text) return null;
  const seconds = Number.parseFloat(match[1].replace(',', '.')) || 0;
  return { text, ttl: Math.min(BURN_MAX_SECONDS, Math.max(1, Math.ceil(seconds))) };
}
