export const RETENTION_SECONDS = [5, 10, 30, 60, 300, 900, 3600, 86400] as const;

export type ChatMode = 'live' | 'persistent' | `ttl-${number}`;

// Saved rooms live in their own Durable Object class, so the persistent mode is only valid where that class asks for it.
export function normalizeChatMode(value: unknown, allowPersistent = false): ChatMode {
  if (value === 'live') return 'live';
  if (value === 'persistent') return allowPersistent ? 'persistent' : 'live';
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

export type RoomVersionStamp = { mode: string; v?: number };

export function configStamp(config: RoomVersionStamp): string {
  return `${config.v}:${config.mode}`;
}

export type RoomLookup = 'open' | 'missing' | 'mismatch';

/**
 * What a joiner does with the settings the server reports: a channel without settings holds no room, and a room whose
 * format or mode differs from what this browser saw there before is refused rather than joined.
 */
export function roomLookup(config: RoomVersionStamp | null, remembered: string | null): RoomLookup {
  if (!config) return 'missing';
  if (config.v !== 3 || (remembered && remembered !== configStamp(config))) return 'mismatch';
  return 'open';
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

export const MIN_ROOM_PASSWORD_LENGTH = 16;
const PASSPHRASE_WORDS = 5;
// Anything stored or relayed under a password can be guessed offline at one Argon2id derivation (64 MiB, 3 passes) per try,
// so the floor is set where that stays out of reach even for a well-funded attacker.
const MIN_PASSWORD_BITS = 64;
const COMMON = ['password', 'passwort', 'heslo', 'haslo', 'contrasena', 'motdepasse', 'qwert', 'qwertz', 'azerty', 'asdf', 'yxcv', 'zxcv',
  'admin', 'letmein', 'welcome', 'iloveyou', 'monkey', 'dragon', 'secret', 'encrypt', 'abc123', '123456', '654321', '111111', '000000'];
const KEYBOARD_ROWS = ['qwertyuiop', 'qwertzuiop', 'azertyuiop', 'asdfghjkl', 'zxcvbnm', 'yxcvbnm', '1234567890', 'abcdefghijklmnopqrstuvwxyz',
  '!@#$%^&*()', 'ěščřžýáíé', 'ľščťžýáíé', 'qaz', 'qay', 'wsx', 'edc', 'rfv', 'tgb', 'yhn', 'zhn', 'ujm'];
const MAX_ANALYZED_CHARS = 256;
const MIN_REPEAT_CHARS = 4;
const REPEAT_BITS = 8;
const BITS_PER_DISTINCT_CHAR = Math.log2(95);

export type PasswordChecks = { length: boolean; variety: boolean; strength: boolean; distinct: boolean };

function characterKinds(value: string): number {
  return [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u].filter((re) => re.test(value)).length;
}

// A word is a lowercase or capitalized letter run; mixed case inside a run reads as random letters instead.
const WORD_RE = /^\p{Lu}?\p{Ll}{2,}$/u;

function passphraseWords(value: string): string[] {
  return value.split(/[^\p{L}]+/u).filter((word) => WORD_RE.test(word) || /^\p{Lu}{3,}$/u.test(word));
}

// Characters that only repeat or continue a run (aaa, abcd, 4321, qwer) add almost nothing for a guesser.
function effectiveLength(value: string): number {
  const lower = value.toLowerCase();
  let length = 0;
  for (let i = 0; i < lower.length; i++) {
    const prev = lower[i - 1];
    const prev2 = lower[i - 2];
    const repeat = prev !== undefined && lower[i] === prev && lower[i] === prev2;
    const run = prev !== undefined && prev2 !== undefined && KEYBOARD_ROWS.some((row) => {
      const a = row.indexOf(prev2), b = row.indexOf(prev), c = row.indexOf(lower[i]);
      return a >= 0 && b >= 0 && c >= 0 && ((b === a + 1 && c === b + 1) || (b === a - 1 && c === b - 1));
    });
    if (!repeat && !run) length++;
  }
  for (const word of COMMON) if (lower.includes(word)) length -= word.length - 1;
  return Math.max(0, length);
}

const LEET: Record<string, string> = { '@': 'a', '4': 'a', '0': 'o', '3': 'e', '$': 's', '5': 's', '7': 't' };

function foldCase(value: string): string {
  const lower = value.toLowerCase();
  return lower.length === value.length ? lower : value;
}

// Spelling a common password with symbols (P@ssw0rd, adm1n, we1come) hides it from nobody who is guessing.
function withoutCommon(value: string): { rest: string; found: number } {
  const readings = (text: string) => {
    const lower = foldCase(text);
    const plain = lower.replace(/[@403$57]/g, (char) => LEET[char]);
    return [lower, plain.replace(/[1!|]/g, 'i'), plain.replace(/[1!|]/g, 'l')];
  };
  let rest = value;
  let found = 0;
  for (const word of COMMON) {
    for (;;) {
      const at = readings(rest).map((reading) => reading.indexOf(word)).find((index) => index >= 0);
      if (at === undefined) break;
      rest = rest.slice(0, at) + rest.slice(at + word.length);
      found++;
    }
  }
  return { rest, found };
}

// Whatever repeats something typed earlier, forwards or backwards and in any case, costs one back-reference however long it is.
function withoutRepeats(value: string): { rest: string; repeats: number } {
  const lower = foldCase(value);
  let rest = '';
  let repeats = 0;
  for (let i = 0; i < value.length;) {
    const backwards = [...lower.slice(0, i)].reverse().join('');
    let length = value.length - i;
    while (length >= MIN_REPEAT_CHARS) {
      const part = lower.slice(i, i + length);
      const at = lower.indexOf(part);
      if ((at >= 0 && at < i) || backwards.includes(part)) break;
      length--;
    }
    if (length >= MIN_REPEAT_CHARS) {
      repeats++;
      i += length;
    } else {
      rest += value[i++];
    }
  }
  return { rest, repeats };
}

// Letters, digits and symbols read apart, which unmasks patterns woven together such as 1q2w3e4r or a1!b2@c3#.
function strandBits(value: string): number {
  const strand = (re: RegExp) => effectiveLength([...value.matchAll(re)].map(([char]) => char).join('').replace(/(.)\1+/giu, '$1'));
  const pool = (/\p{Ll}/u.test(value) ? 26 : 0) + (/\p{Lu}/u.test(value) ? 26 : 0);
  return strand(/\p{L}/gu) * Math.log2(pool || 1) + strand(/\p{N}/gu) * Math.log2(10) + strand(/[^\p{L}\p{N}\s]/gu) * 5;
}

/**
 * A deliberately conservative guess-cost estimate: the lowest of several readings of the password. Words count as about
 * 12 bits however long they are, years, runs and repeats count as almost nothing, and only letters, digits and symbols
 * that look random earn full per-character credit.
 */
export function passwordBits(password: string): number {
  const value = password.trim().slice(0, MAX_ANALYZED_CHARS);
  const { rest: uncommon, found } = withoutCommon(value);
  const { rest, repeats } = withoutRepeats(uncommon);
  const spent = found + repeats * REPEAT_BITS;
  return Math.min(
    tokenBits(value),
    tokenBits(rest) + spent,
    strandBits(rest) + spent,
    new Set(foldCase(value)).size * BITS_PER_DISTINCT_CHAR,
  );
}

function tokenBits(value: string): number {
  let bits = 0;
  const seen = new Set<string>();
  for (const [token] of value.matchAll(/\p{L}+|\p{N}+|\s+|[^\p{L}\p{N}\s]+/gu)) {
    const lower = token.toLowerCase();
    if (/^\s+$/.test(token) || /^[-_.]$/.test(token)) {
      bits += 1;
    } else if (/^\p{L}+$/u.test(token) && (WORD_RE.test(token) || /^\p{Lu}{3,}$/u.test(token))) {
      const common = COMMON.some((word) => lower.includes(word)) || seen.has(lower);
      bits += common ? 1 : Math.min(12 + (/^\p{Lu}/u.test(token) ? 1 : 0), effectiveLength(token) * Math.log2(26));
      seen.add(lower);
    } else if (/^\p{L}+$/u.test(token)) {
      const pool = (/\p{Ll}/u.test(token) ? 26 : 0) + (/\p{Lu}/u.test(token) ? 26 : 0);
      bits += effectiveLength(token) * Math.log2(pool);
    } else if (/^\p{N}+$/u.test(token)) {
      bits += /^(19|20)\d\d$/.test(token) ? 7 : effectiveLength(token) * Math.log2(10);
    } else {
      bits += effectiveLength(token) * 5;
    }
  }
  return bits;
}

export function checkRoomPassword(password: string, roomName: string): PasswordChecks {
  const value = password.trim();
  const lower = value.toLowerCase();
  const room = roomName.trim().toLowerCase();
  return {
    length: value.length >= MIN_ROOM_PASSWORD_LENGTH,
    variety: characterKinds(value) >= 3 || new Set(passphraseWords(lower)).size >= PASSPHRASE_WORDS,
    strength: passwordBits(value) >= MIN_PASSWORD_BITS,
    distinct: value.length > 0 && (!room || (lower !== room && !(room.length >= 3 && lower.includes(room)))),
  };
}

export function roomPasswordOk(password: string, roomName: string): boolean {
  const checks = checkRoomPassword(password, roomName);
  return checks.length && checks.variety && checks.strength && checks.distinct;
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
