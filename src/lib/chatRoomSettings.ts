export const RETENTION_SECONDS = [5, 10, 30, 60, 300, 900, 3600, 86400] as const;

export type ChatMode = 'live' | `ttl-${number}`;

export function normalizeChatMode(value: unknown): ChatMode {
  if (value === 'live') return 'live';
  if (value === 'burn') return 'ttl-10';
  if (typeof value === 'string') {
    const match = /^ttl-(\d{1,6})$/.exec(value);
    if (match && (RETENTION_SECONDS as readonly number[]).includes(Number(match[1]))) return value as ChatMode;
  }
  return 'live';
}

export function chatModeTtlSeconds(mode: ChatMode): number {
  return mode === 'live' ? 0 : Number(mode.slice(4));
}

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
