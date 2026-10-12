import { t } from './t';

export type Alias = { a: number; n: number; h: number };

export const ALIAS_WORDS = 20;
const STORAGE_PREFIX = 'encrypt.click:alias:';

export function newAlias(): Alias {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return { a: bytes[0] % ALIAS_WORDS, n: bytes[1] % ALIAS_WORDS, h: ((bytes[2] << 8) | bytes[3]) % 360 };
}

export function parseAlias(value: unknown): Alias | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [a, n, h] = value;
  if (![a, n, h].every((x) => Number.isInteger(x) && x >= 0)) return null;
  if (a >= ALIAS_WORDS || n >= ALIAS_WORDS || h >= 360) return null;
  return { a, n, h };
}

export function aliasWire(alias: Alias): [number, number, number] {
  return [alias.a, alias.n, alias.h];
}

export function aliasKey(alias: Alias): string {
  return `${alias.a}-${alias.n}-${alias.h}`;
}

/** The adjective agrees with the animal's grammatical gender, and each locale sets the word order. */
export function aliasName(dict: Record<string, string>, alias: Alias): string {
  const animal = t(dict, `chat.alias.animal.${alias.n}`);
  const feminine = dict[`chat.alias.animal.${alias.n}.g`] === 'f';
  const adj = (feminine && dict[`chat.alias.adj.${alias.a}.f`]) || t(dict, `chat.alias.adj.${alias.a}`);
  return (dict['chat.alias.format'] || '{adj} {animal}').replace('{adj}', adj).replace('{animal}', animal);
}

export function aliasColor(alias: Alias): string {
  return `hsl(${alias.h}, 65%, 50%)`;
}

export function aliasGradient(alias: Alias): string {
  return `linear-gradient(135deg, hsl(${alias.h}, 70%, 55%), hsl(${(alias.h + 40) % 360}, 65%, 42%))`;
}

export function nameToGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const hue1 = (h >>> 0) % 360;
  const hue2 = (hue1 + 40 + ((h >>> 8) % 80)) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 70%, 55%), hsl(${hue2}, 65%, 45%))`;
}

export function gradientFor(alias: Alias | undefined, name: string): string {
  return alias ? aliasGradient(alias) : nameToGradient(name);
}

export function initialsOf(name: string): string {
  return name.split(' ').map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

/** One alias per room, kept in this browser so a reload keeps the same name and color. */
export function loadAlias(room: string): Alias {
  const key = `${STORAGE_PREFIX}${room}`;
  try {
    const stored = parseAlias(JSON.parse(localStorage.getItem(key) || 'null'));
    if (stored) return stored;
  } catch {}
  const alias = newAlias();
  try {
    localStorage.setItem(key, JSON.stringify(aliasWire(alias)));
  } catch {}
  return alias;
}
