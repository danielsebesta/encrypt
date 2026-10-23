// Astro endpoints and the platform entry can be separate bundles, so the environment travels on globalThis.
const KEY = '__encryptClickEnv';

type EnvHolder = { [KEY]?: Record<string, string | undefined> };

export function setRuntimeEnv(env: Record<string, unknown>): void {
  const strings: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) if (typeof value === 'string') strings[name] = value;
  (globalThis as EnvHolder)[KEY] = strings;
}

export function runtimeEnv(): Record<string, string | undefined> {
  const held = (globalThis as EnvHolder)[KEY];
  if (held) return held;
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

export function envString(name: string): string {
  return runtimeEnv()[name]?.trim() ?? '';
}
